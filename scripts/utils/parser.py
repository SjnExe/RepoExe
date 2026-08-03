import hashlib
import json
from pathlib import Path

import yaml
from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class ResourceConfig(BaseModel):
    zram: int = 0
    swap: int = 0
    free_space: bool = False


class ChannelOverride(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    version: str | None = None
    revision: int | None = None
    architecture: str | None = Field(default=None, alias="arch")
    build_system: str | None = None
    source_url: str | None = Field(
        default=None, validation_alias=AliasChoices("source_url", "source", "url")
    )
    sha256: str | None = None
    formats: list[str] | None = None
    build_deps: list[str] | None = None
    deps: list[str] | None = Field(default=None, alias="depends")
    heavy_build: bool | None = None
    auto_update: bool | None = None
    update_strategy: str | None = Field(default=None, alias="strategy")
    custom_update_cmd: str | None = None
    patches: list[str] | None = None
    phases: dict[str, str] | None = None
    vars: dict[str, str] | None = None
    component: str | None = None
    resources: ResourceConfig | None = None


class PackageRecipe(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    version: str
    revision: int = 0
    architecture: str = Field(default="aarch64", alias="arch")
    description: str = Field(default="", alias="desc")
    license: str = "MIT"
    homepage: str = ""
    maintainer: str = "SjnExe"
    build_system: str = "custom"
    source_url: str | None = Field(
        default=None, validation_alias=AliasChoices("source_url", "source", "url")
    )
    sha256: str | None = None
    formats: list[str] = Field(default_factory=lambda: ["apt", "pacman", "apk"])
    build_deps: list[str] = Field(default_factory=list)
    deps: list[str] = Field(default_factory=list, alias="depends")
    heavy_build: bool = False
    auto_update: bool = False
    update_strategy: str | None = Field(default=None, alias="strategy")
    custom_update_cmd: str | None = None
    patches: list[str] = Field(default_factory=list)
    phases: dict[str, str] = Field(default_factory=dict)
    vars: dict[str, str] = Field(default_factory=dict)
    channels: dict[str, ChannelOverride] = Field(default_factory=dict)
    active_channel: str = "latest"
    state_hash: str = ""
    component: str = "main"
    resources: ResourceConfig = Field(default_factory=ResourceConfig)

    def get_channel_recipe(self, channel_name: str = "latest") -> "PackageRecipe":
        data = self.model_dump() if hasattr(self, "model_dump") else self.dict()

        if channel_name in self.channels:
            override = self.channels[channel_name]
            override_data = (
                override.model_dump(exclude_unset=True)
                if hasattr(override, "model_dump")
                else override.dict(exclude_unset=True)
            )
            data.update(override_data)

        if (
            data.get("source_url")
            and isinstance(data["source_url"], str)
            and "{version}" in data["source_url"]
        ):
            data["source_url"] = data["source_url"].replace(
                "{version}", data.get("version", "")
            )

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
            "build_system": self.build_system,
            "source_url": self.source_url,
            "sha256": self.sha256,
            "formats": sorted(self.formats),
            "patches": self.patches,
            "phases": self.phases,
            "vars": self.vars,
            "channel": self.active_channel,
            "component": self.component,
        }
        raw_json = json.dumps(payload, sort_keys=True)
        return hashlib.sha256(raw_json.encode("utf-8")).hexdigest()[:16]


def parse_recipe(recipe_path: Path, channel: str = "latest") -> PackageRecipe:
    if not recipe_path.exists():
        raise FileNotFoundError(f"Recipe file not found: {recipe_path}")

    raw_data = yaml.safe_load(recipe_path.read_text(encoding="utf-8"))
    base_recipe = PackageRecipe(**raw_data)
    return base_recipe.get_channel_recipe(channel)
