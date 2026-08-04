from pathlib import Path
from collections import deque

from utils.parser import PackageRecipe, parse_recipe


class DependencyGraph:
    def __init__(self, packages_dir: Path):
        self.packages_dir = Path(packages_dir)
        self.recipes: dict[str, PackageRecipe] = {}
        self._load_recipes()

    def _load_recipes(self) -> None:
        for pkg_dir in self.packages_dir.iterdir():
            recipe_file = pkg_dir / "build.yml"
            if pkg_dir.is_dir() and recipe_file.exists():
                recipe = parse_recipe(recipe_file)
                self.recipes[recipe.name] = recipe

    def resolve_build_order(self) -> list[str]:
        """Topological sort to determine clean build order considering dependencies."""
        graph: dict[str, list[str]] = {}
        in_degree: dict[str, int] = {}

        # Initialize graph and in-degrees
        for pkg_name in self.recipes:
            graph[pkg_name] = []
            in_degree[pkg_name] = 0

        # Build graph
        for pkg_name, recipe in self.recipes.items():
            deps = recipe.deps or []
            build_deps = recipe.build_deps or []

            # Combine all dependencies
            all_deps = set(deps + build_deps)

            for dep in all_deps:
                # We only care about dependencies that are local packages
                if dep in self.recipes:
                    graph[dep].append(pkg_name)
                    in_degree[pkg_name] += 1

        # Topological Sort using Kahn's Algorithm
        queue = deque([pkg for pkg in self.recipes if in_degree[pkg] == 0])
        order = []

        while queue:
            node = queue.popleft()
            order.append(node)

            for neighbor in graph.get(node, []):
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        # Check for cycles
        if len(order) != len(self.recipes):
            raise ValueError("Dependency cycle detected in packages")

        return order

    def get_shards(
        self,
        target_packages: list[str] | None = None,
        excluded_packages: set[str] | None = None,
        is_pr: bool = False,
        num_shards: int = 4,
    ) -> list[list[str]]:
        """Splits target packages into balanced matrix shards for CI workflow runners."""
        if target_packages:
            pkgs = [p for p in target_packages if (self.packages_dir / p).exists()]
        else:
            pkgs = self.resolve_build_order()

        if excluded_packages:
            pkgs = [p for p in pkgs if p not in excluded_packages]

        if not pkgs:
            return []

        # Group packages into layers based on dependencies to maximize parallelization safely
        # Note: A full dependency-aware sharding would need careful orchestration.
        # For now, we split maintaining relative topological order.

        shards: list[list[str]] = [[] for _ in range(num_shards)]
        for idx, pkg in enumerate(pkgs):
            shards[idx % num_shards].append(pkg)

        return [s for s in shards if s]
