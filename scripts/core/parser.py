from pathlib import Path
from typing import Dict, Optional
from pydantic import BaseModel, Field
import yaml


class Phases(BaseModel):
    configure: Optional[str] = None
    make: Optional[str] = None
    install: Optional[str] = None


class PackageRecipe(BaseModel):
    name: str
    version: str
    revision: int = 0
    architecture: str = "aarch64"
    description: str
    license: str
    homepage: Optional[str] = None
    maintainer: Optional[str] = None
    build_system: str = "custom"
    source_url: Optional[str] = None
    sha256: Optional[str] = None
    vars: Dict[str, str] = Field(default_factory=dict)
    phases: Optional[Phases] = None


def parse_recipe(recipe_path: Path) -> PackageRecipe:
    if not recipe_path.exists():
        raise FileNotFoundError(f"Recipe file not found: {recipe_path}")
    
    with open(recipe_path, "r", encoding="utf-8") as f:
        content = yaml.safe_load(f)
        
    return PackageRecipe.model_validate(content)
