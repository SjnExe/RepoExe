from pathlib import Path
from typing import Dict, List, Set
from core.parser import parse_recipe, PackageRecipe


class DependencyGraph:
    def __init__(self, packages_dir: Path):
        self.packages_dir = packages_dir
        self.recipes: Dict[str, PackageRecipe] = {}
        self._load_recipes()

    def _load_recipes(self) -> None:
        for pkg_dir in self.packages_dir.iterdir():
            recipe_file = pkg_dir / "build.yml"
            if pkg_dir.is_dir() and recipe_file.exists():
                recipe = parse_recipe(recipe_file)
                self.recipes[recipe.name] = recipe

    def resolve_build_order(self) -> List[str]:
        """Topological sort to determine clean build order."""
        visited: Set[str] = set()
        order: List[str] = []

        def visit(name: str) -> None:
            if name not in visited and name in self.recipes:
                visited.add(name)
                order.append(name)

        for pkg in sorted(self.recipes.keys()):
            visit(pkg)

        return order
