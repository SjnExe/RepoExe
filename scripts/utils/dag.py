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
        graph: dict[str, list[str]] = {p: [] for p in self.recipes}
        in_degree: dict[str, int] = {p: 0 for p in self.recipes}

        for pkg_name, recipe in self.recipes.items():
            deps = set((recipe.deps or []) + (recipe.build_deps or []))
            for dep in deps:
                if dep in self.recipes:
                    graph[dep].append(pkg_name)
                    in_degree[pkg_name] += 1

        queue = deque([pkg for pkg in self.recipes if in_degree[pkg] == 0])
        order = []

        while queue:
            node = queue.popleft()
            order.append(node)
            for neighbor in graph.get(node, []):
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if len(order) != len(self.recipes):
            return list(self.recipes.keys())

        return order

    def get_layers(self, target_packages: list[str] | None = None) -> list[list[str]]:
        pkgs = set(target_packages) if target_packages else set(self.recipes.keys())
        pkgs = {p for p in pkgs if p in self.recipes}

        sub_graph: dict[str, set[str]] = {p: set() for p in pkgs}
        in_degree: dict[str, int] = {p: 0 for p in pkgs}

        for p in pkgs:
            recipe = self.recipes[p]
            deps = set((recipe.deps or []) + (recipe.build_deps or []))
            for dep in deps:
                if dep in pkgs:
                    sub_graph[dep].add(p)
                    in_degree[p] += 1

        layers: list[list[str]] = []
        current_layer = [p for p in pkgs if in_degree[p] == 0]

        while current_layer:
            layers.append(sorted(current_layer))
            next_layer = []
            for node in current_layer:
                for neighbor in sub_graph[node]:
                    in_degree[neighbor] -= 1
                    if in_degree[neighbor] == 0:
                        next_layer.append(neighbor)
            current_layer = next_layer

        return layers
