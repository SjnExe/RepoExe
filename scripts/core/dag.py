"""Matrix Sharding and DAG Dependency Resolver for RepoExe."""

import os
from typing import Dict, List, Set, Optional

from pydantic import BaseModel
from .parser import parse_build_yml, BuildYml


class DAGNode(BaseModel):
    name: str
    pkg: BuildYml
    dir_path: str
    deps: Set[str]
    needed_by: Set[str] = set()

    model_config = {'arbitrary_types_allowed': True}


class DAG:
    def __init__(self, packages_dir: str, arch: str):
        self.packages_dir = packages_dir
        self.arch = arch
        self.nodes: Dict[str, DAGNode] = {}
        self._load_packages()

    def _load_packages(self) -> None:
        """Parses all build.yml files and builds the initial dependency map."""
        if not os.path.exists(self.packages_dir):
            return

        for pkg_dir in os.listdir(self.packages_dir):
            build_yml_path = os.path.join(self.packages_dir, pkg_dir, 'build.yml')
            if not os.path.isfile(build_yml_path):
                continue

            try:
                pkg = parse_build_yml(build_yml_path)
            except Exception as e:
                print(f'Failed to parse {build_yml_path}: {e}')
                continue

            # Skip if arch is excluded
            if self.arch in pkg.excluded_arches:
                continue

            # Combine dependencies and pre_dependencies
            all_deps = set()
            for repo, deps in pkg.depends.items():
                # For DAG resolution within our local build tree,
                # we primarily care about dependencies that *we* build (typically 'local' or just any name we resolve)
                all_deps.update(deps)
            for repo, deps in pkg.pre_depends.items():
                all_deps.update(deps)

            node = DAGNode(name=pkg.name, pkg=pkg, dir_path=os.path.join(self.packages_dir, pkg_dir), deps=all_deps)
            self.nodes[pkg.name] = node

            # Handle subpackages - they shouldn't depend on each other for build order
            # but they exist. For now, the main package dictates build order.

        self._build_edges()

    def _build_edges(self) -> None:
        """Populates the needed_by inverse graph."""
        for name, node in self.nodes.items():
            deps_to_remove = set()
            for dep in node.deps:
                # If dependency is built by us, add to needed_by
                if dep in self.nodes:
                    self.nodes[dep].needed_by.add(name)
                else:
                    # External dependency, ignore in our local DAG
                    deps_to_remove.add(dep)
            node.deps.difference_update(deps_to_remove)

    def get_build_order(self, target: Optional[str] = None) -> List[DAGNode]:
        """Performs a topological sort to determine the build order."""
        build_order = []
        visited = set()

        if target:
            if target not in self.nodes:
                raise ValueError(f"Target package '{target}' not found or excluded for architecture '{self.arch}'.")

            def dfs(node_name: str):
                if node_name in visited:
                    return
                for dep in sorted(self.nodes[node_name].deps):
                    dfs(dep)
                visited.add(node_name)
                build_order.append(self.nodes[node_name])

            dfs(target)
            return build_order

        # Full build order
        # Leaf packages (no deps)
        leaf_pkgs = [node for name, node in self.nodes.items() if not node.deps]
        if not leaf_pkgs and self.nodes:
            raise ValueError('Cycle detected: No package without dependencies found.')

        pkg_queue = sorted(leaf_pkgs, key=lambda p: p.name)

        remaining_deps = {name: set(node.deps) for name, node in self.nodes.items()}

        while pkg_queue:
            node = pkg_queue.pop(0)
            if node.name in visited:
                continue

            visited.add(node.name)
            build_order.append(node)

            for needed_name in sorted(node.needed_by):
                remaining_deps[needed_name].discard(node.name)
                if not remaining_deps[needed_name]:
                    pkg_queue.append(self.nodes[needed_name])

        if len(build_order) != len(self.nodes):
            raise ValueError('Cycle detected in dependency graph.')

        return build_order

    def export_graphviz(self, output_path: str = 'dag.dot') -> None:
        """Exports the DAG to a Graphviz .dot file."""
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write('digraph G {\n')
            f.write('  node [shape=box];\n')
            for name, node in self.nodes.items():
                for dep in node.deps:
                    f.write(f'  "{dep}" -> "{name}";\n')
            f.write('}\n')
        print(f'Exported DAG Graphviz map to {output_path}')

    def get_shards(
        self,
        target_packages: Optional[List[str]] = None,
        excluded_packages: Optional[Set[str]] = None,
        is_pr: bool = False,
        num_shards: int = 4,
    ) -> List[List[str]]:
        """Splits independent packages into parallel shards.
        If target_packages is provided, only shards the dependencies and the targets themselves.
        """
        if excluded_packages is None:
            excluded_packages = set()

        if target_packages is None:
            ordered_pkgs = [node.name for node in self.get_build_order()]
        else:
            if is_pr:
                # Add reverse dependencies to target_packages to ensure downstream packages aren't broken
                additional_targets = set()
                for t in target_packages:
                    if t in self.nodes:
                        # DFS on needed_by
                        stack = [t]
                        visited_rev = set()
                        while stack:
                            curr = stack.pop()
                            if curr not in visited_rev:
                                visited_rev.add(curr)
                                if curr != t:
                                    additional_targets.add(curr)
                                for reverse_dep in self.nodes[curr].needed_by:
                                    stack.append(reverse_dep)

                target_packages.extend(list(additional_targets))

            # We want to build the union of all targets and their dependencies.
            # We must maintain topological order.
            ordered_pkgs = []
            visited_overall = set()
            for t in target_packages:
                try:
                    t_order = self.get_build_order(target=t)
                    for node in t_order:
                        if node.name not in visited_overall:
                            visited_overall.add(node.name)
                            ordered_pkgs.append(node.name)
                except ValueError:
                    # Ignore packages that are not found or excluded for this arch
                    pass

        # Validate exclusions
        if excluded_packages:
            for pkg in ordered_pkgs:
                if pkg in excluded_packages:
                    raise ValueError(f"Excluded package '{pkg}' is a strict dependency of a package being built.")

        # We need to ensure that connected components (dependency chains)
        # stay in the same shard, because each shard runs on an isolated runner.

        # Build an undirected graph to find connected components
        adj: Dict[str, Set[str]] = {pkg: set() for pkg in ordered_pkgs}
        for pkg in ordered_pkgs:
            node = self.nodes[pkg]
            for dep in node.deps:
                if dep in adj:
                    adj[pkg].add(dep)
                    adj[dep].add(pkg)

        visited_components = set()
        components: List[List[str]] = []

        for pkg in ordered_pkgs:
            if pkg not in visited_components:
                # BFS to find the whole connected component
                comp = []
                queue = [pkg]
                visited_components.add(pkg)

                while queue:
                    curr = queue.pop(0)
                    comp.append(curr)
                    for neighbor in adj[curr]:
                        if neighbor not in visited_components:
                            visited_components.add(neighbor)
                            queue.append(neighbor)

                # Sort component members topologically so they build in the right order
                comp_sorted = [p for p in ordered_pkgs if p in comp]
                components.append(comp_sorted)

        # Split components into isolated and regular components
        isolated_components = []
        regular_components = []
        for comp in components:
            # If any package in the component requires an isolated shard,
            # the whole connected component must be placed in its own shard
            if any(self.nodes[p].pkg.isolated_shard for p in comp):
                isolated_components.append(comp)
            else:
                regular_components.append(comp)

        # Distribute regular components across regular shards
        shards = [[] for _ in range(num_shards)]
        for i, comp in enumerate(regular_components):
            shards[i % num_shards].extend(comp)

        # Append isolated components as dedicated shards
        for comp in isolated_components:
            shards.append(comp)

        return shards
