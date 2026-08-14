import shutil
from pathlib import Path

import yaml
from core.parser import PackageRecipe


def process_subpackages(
    pkg_dir: Path, stage_dir: Path, parent_recipe: PackageRecipe
) -> list[tuple[PackageRecipe, Path]]:
    subpackages = []
    subpkg_dir = pkg_dir / "subpkg"
    if not subpkg_dir.exists():
        return subpackages

    for sub_file in sorted(subpkg_dir.glob("*.yml")):
        data = yaml.safe_load(sub_file.read_text(encoding="utf-8")) or {}
        sub_name = data.get("name", f"{parent_recipe.name}-{sub_file.stem}")
        sub_desc = data.get(
            "description", f"{sub_name} subpackage for {parent_recipe.name}"
        )
        sub_files = data.get("files", [])
        depend_on_parent = data.get("depend_on_parent", True)

        sub_stage = stage_dir.parent / f"stage_{sub_file.stem}"
        sub_stage.mkdir(parents=True, exist_ok=True)

        for pat in sub_files:
            for matched in stage_dir.glob(f"**/{pat.lstrip('/')}"):
                if matched.exists():
                    rel = matched.relative_to(stage_dir)
                    target = sub_stage / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(matched), str(target))

        sub_deps = list(parent_recipe.deps)
        if depend_on_parent and parent_recipe.name not in sub_deps:
            sub_deps.append(parent_recipe.name)

        sub_recipe = PackageRecipe(
            name=sub_name,
            version=parent_recipe.version,
            revision=parent_recipe.revision,
            arch=parent_recipe.arch,
            description=sub_desc,
            license=parent_recipe.license,
            homepage=parent_recipe.homepage,
            maintainer=parent_recipe.maintainer,
            formats=parent_recipe.formats,
            deps=sub_deps,
        )
        subpackages.append((sub_recipe, sub_stage))

    return subpackages
