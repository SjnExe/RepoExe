import hashlib
import json
from pathlib import Path

from pydantic import BaseModel, Field


class ChannelOverride(BaseModel):
    version: str | None = None
    revision: int | None = None
    source_url: str | None = None
    sha256: str | None = None
    auto_update: bool | None = None
    update_strategy: str | None = None
    patches: list[str] | None = None
    phases: dict[str, str] | None = None
    vars: dict[str, str] | None = None


class PackageRecipe(BaseModel):
    name: str
    version: str
    revision: int = 0
    architecture: str = "aarch64"
    description: str = ""
    license: str = "MIT"
    homepage: str = ""
    maintainer: str = "SjnExe"
    build_system: str = "custom"
    source_url: str | None = None
    sha256: str | None = None
    auto_update: bool = True
    update_strategy: str = "auto"
    patches: list[str] = Field(default_factory=list)
    phases: dict[str, str] = Field(default_factory=dict)
    vars: dict[str, str] = Field(default_factory=dict)
    channels: dict[str, ChannelOverride] = Field(default_factory=dict)
    active_channel: str = "latest"
    state_hash: str = ""

    def get_channel_recipe(self, channel_name: str = "latest") -> "PackageRecipe":
        if channel_name == "latest" or channel_name not in self.channels:
            resolved = self.model_copy(deep=True)
            resolved.active_channel = channel_name
            resolved.state_hash = resolved.compute_state_hash()
            return resolved

        override = self.channels[channel_name]
        data = self.model_dump()

        # Merge override fields if present
        if override.version is not None:
            data["version"] = override.version
        if override.revision is not None:
            data["revision"] = override.revision
        if override.source_url is not None:
            data["source_url"] = override.source_url
        if override.sha256 is not None:
            data["sha256"] = override.sha256
        if override.auto_update is not None:
            data["auto_update"] = override.auto_update
        if override.patches is not None:
            data["patches"] = override.patches
        if override.phases is not None:
            data["phases"] = override.phases
        if override.vars is not None:
            data["vars"] = {**data.get("vars", {}), **override.vars}

        data["active_channel"] = channel_name
        resolved = PackageRecipe(**data)
        resolved.state_hash = resolved.compute_state_hash()
        return resolved

    def compute_state_hash(self) -> str:
        payload = {
            "name": self.name,
            "version": self.version,
            "revision": self.revision,
            "architecture": self.architecture,
            "source_url": self.source_url,
            "sha256": self.sha256,
            "patches": self.patches,
            "phases": self.phases,
            "vars": self.vars,
            "channel": self.active_channel,
        }
        raw_json = json.dumps(payload, sort_keys=True)
        return hashlib.sha256(raw_json.encode("utf-8")).hexdigest()[:16]


def parse_recipe(recipe_path: Path, channel: str = "latest") -> PackageRecipe:
    import yaml

    if not recipe_path.exists():
        raise FileNotFoundError(f"Recipe file not found: {recipe_path}")

    raw_data = yaml.safe_load(recipe_path.read_text(encoding="utf-8"))
    base_recipe = PackageRecipe(**raw_data)
    return base_recipe.get_channel_recipe(channel)
