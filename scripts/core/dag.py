from pathlib import Path

from core.parser import PackageRecipe, parse_recipe


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
        """Topological sort to determine clean build order."""
        visited: set[str] = set()
        order: list[str] = []

        def visit(name: str) -> None:
            if name not in visited and name in self.recipes:
                visited.add(name)
                order.append(name)

        for pkg in sorted(self.recipes.keys()):
            visit(pkg)

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
            pkgs = sorted([d.name for d in self.packages_dir.iterdir() if d.is_dir()])

        if excluded_packages:
            pkgs = [p for p in pkgs if p not in excluded_packages]

        if not pkgs:
            return []

        shards: list[list[str]] = [[] for _ in range(num_shards)]
        for idx, pkg in enumerate(pkgs):
            shards[idx % num_shards].append(pkg)

        return [s for s in shards if s]
