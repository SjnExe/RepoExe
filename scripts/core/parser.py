import hashlib
import json
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

import yaml


@dataclass
class ResourceConfig:
    zram: int = 0
    swap: int = 0
    free_space: bool = False


@dataclass
class ChannelOverride:
    version: str | None = None
    revision: int | None = None
    arch: str | None = None
    description: str | None = None
    license: str | None = None
    homepage: str | None = None
    maintainer: str | None = None
    component: str | None = None
    build_system: str | None = None
    source_url: str | None = None
    sha256: str | None = None
    formats: list[str] | None = None
    build_deps: list[str] | None = None
    deps: list[str] | None = None
    recommends: list[str] | None = None
    suggests: list[str] | None = None
    conflicts: list[str] | None = None
    provides: list[str] | None = None
    replaces: list[str] | None = None
    heavy_build: bool | None = None
    auto_update: bool | None = None
    update_strategy: str | None = None
    custom_update_cmd: str | None = None
    patches: list[str] | None = None
    cflags: str | None = None
    cxxflags: str | None = None
    ldflags: str | None = None
    phases: dict[str, str] | None = None
    vars: dict[str, str] | None = None
    toolchains: dict[str, str] | None = None


@dataclass
class PackageRecipe:
    name: str
    version: str
    revision: int = 0
    arch: str = "aarch64"
    description: str = ""
    license: str = "MIT"
    homepage: str = ""
    maintainer: str = "SjnExe"
    component: str = "main"
    build_system: str = "custom"
    source_url: str | None = None
    sha256: str | None = None
    formats: list[str] = field(default_factory=lambda: ["apt", "pacman", "apk"])
    build_deps: list[str] = field(default_factory=list)
    deps: list[str] = field(default_factory=list)
    recommends: list[str] = field(default_factory=list)
    suggests: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    provides: list[str] = field(default_factory=list)
    replaces: list[str] = field(default_factory=list)
    resources: ResourceConfig = field(default_factory=ResourceConfig)
    heavy_build: bool = False
    auto_update: bool = False
    update_strategy: str | None = None
    custom_update_cmd: str | None = None
    patches: list[str] = field(default_factory=list)
    cflags: str | None = None
    cxxflags: str | None = None
    ldflags: str | None = None
    phases: dict[str, str] = field(default_factory=dict)
    vars: dict[str, str] = field(default_factory=dict)
    toolchains: dict[str, str] = field(default_factory=dict)
    channels: dict[str, ChannelOverride] = field(default_factory=dict)
    active_channel: str = "latest"
    state_hash: str = ""

    def model_dump(self, exclude_unset: bool = False) -> dict:
        d = asdict(self)
        if exclude_unset:
            return {k: v for k, v in d.items() if v is not None}
        return d

    def get_channel_recipe(self, channel_name: str = "latest") -> "PackageRecipe":
        data = self.model_dump()
        if channel_name in self.channels:
            override = self.channels[channel_name]
            override_data = (
                {k: v for k, v in asdict(override).items() if v is not None}
                if isinstance(override, ChannelOverride)
                else override
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
        if isinstance(data.get("resources"), dict):
            data["resources"] = ResourceConfig(**data["resources"])
        if isinstance(data.get("channels"), dict):
            data["channels"] = {
                ch: ChannelOverride(**val) if isinstance(val, dict) else val
                for ch, val in data["channels"].items()
            }

        valid_fields = {f.name for f in fields(PackageRecipe)}
        filtered_data = {k: v for k, v in data.items() if k in valid_fields}
        resolved = PackageRecipe(**filtered_data)
        resolved.state_hash = resolved.compute_state_hash()
        return resolved

    def compute_state_hash(self) -> str:
        payload = {
            "name": self.name,
            "version": self.version,
            "revision": self.revision,
            "arch": self.arch,
            "build_system": self.build_system,
            "source_url": self.source_url,
            "sha256": self.sha256,
            "formats": sorted(self.formats),
            "deps": sorted(self.deps),
            "recommends": sorted(self.recommends),
            "suggests": sorted(self.suggests),
            "conflicts": sorted(self.conflicts),
            "provides": sorted(self.provides),
            "replaces": sorted(self.replaces),
            "patches": self.patches,
            "cflags": self.cflags,
            "cxxflags": self.cxxflags,
            "ldflags": self.ldflags,
            "phases": self.phases,
            "vars": self.vars,
            "channel": self.active_channel,
            "toolchains": self.toolchains,
        }
        raw_json = json.dumps(payload, sort_keys=True)
        return hashlib.sha256(raw_json.encode("utf-8")).hexdigest()[:16]


def parse_recipe(recipe_path: Path, channel: str = "latest") -> PackageRecipe:
    if not recipe_path.exists():
        for alt_name in ("pkg.yml", "build.yml"):
            alt_path = (
                recipe_path.parent / alt_name
                if recipe_path.name in ("pkg.yml", "build.yml")
                else recipe_path / alt_name
            )
            if alt_path.exists():
                recipe_path = alt_path
                break

    if not recipe_path.exists():
        raise FileNotFoundError(f"Recipe file not found: {recipe_path}")

    raw_data = yaml.safe_load(recipe_path.read_text(encoding="utf-8")) or {}
    if "resources" in raw_data and isinstance(raw_data["resources"], dict):
        raw_data["resources"] = ResourceConfig(**raw_data["resources"])
    else:
        raw_data["resources"] = ResourceConfig()

    if "channels" in raw_data and isinstance(raw_data["channels"], dict):
        raw_data["channels"] = {
            k: ChannelOverride(**v) if isinstance(v, dict) else v
            for k, v in raw_data["channels"].items()
        }

    valid_fields = {f.name for f in fields(PackageRecipe)}
    filtered_data = {k: v for k, v in raw_data.items() if k in valid_fields}
    base_recipe = PackageRecipe(**filtered_data)
    return base_recipe.get_channel_recipe(channel)
