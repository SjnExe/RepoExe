from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any


def _interpolate_values(obj: Any, ctx: dict[str, str]) -> Any:
    """Recursively formats templated strings like {version} across all nested data structures."""
    if isinstance(obj, str):
        for k, v in ctx.items():
            obj = obj.replace(f"{{{k}}}", str(v))
        return obj
    if isinstance(obj, dict):
        return {k: _interpolate_values(v, ctx) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_interpolate_values(item, ctx) for item in obj]
    return obj


def resolve_channel_recipe(
    raw_recipe: dict[str, Any], channel_name: str = "latest"
) -> dict[str, Any]:
    """Resolves and flattens a recipe dictionary for a targeted release channel."""
    base_data = copy.deepcopy(raw_recipe)
    channels_map: dict[str, Any] = base_data.pop("channels", {})

    channel_cfg: dict[str, Any] = channels_map.get(channel_name, {})
    if not channel_cfg and channel_name != "latest":
        raise ValueError(f"Requested channel '{channel_name}' not defined in recipe.")

    resolved = copy.deepcopy(base_data)
    resolved["channel"] = channel_name

    for key, val in channel_cfg.items():
        if key in ("deps", "build_deps", "patches", "formats"):
            resolved[key] = copy.deepcopy(val)
        elif key.startswith("extra_"):
            target_key = key.removeprefix("extra_")
            existing_list = resolved.get(target_key, [])
            if isinstance(existing_list, list) and isinstance(val, list):
                merged_list = list(existing_list)
                for item in val:
                    if item not in merged_list:
                        merged_list.append(item)
                resolved[target_key] = merged_list
        elif isinstance(val, dict) and isinstance(resolved.get(key), dict):
            resolved[key] = {**resolved[key], **copy.deepcopy(val)}
        else:
            resolved[key] = copy.deepcopy(val)

    ctx = {
        "name": str(resolved.get("name", "")),
        "version": str(resolved.get("version", "")),
        "revision": str(resolved.get("revision", 0)),
        "channel": str(channel_name),
        "arch": str(resolved.get("arch", "aarch64")),
    }

    return _interpolate_values(resolved, ctx)


def apply_channel_overlay(recipe: Any, channel_name: str = "latest") -> Any:
    """Applies channel overlay and template resolution to a Recipe instance or dictionary."""
    if isinstance(recipe, dict):
        return resolve_channel_recipe(recipe, channel_name)

    raw_dict = {}
    for k in dir(recipe):
        if not k.startswith("_") and not callable(getattr(recipe, k)):
            raw_dict[k] = getattr(recipe, k)

    resolved_dict = resolve_channel_recipe(raw_dict, channel_name)
    for k, v in resolved_dict.items():
        setattr(recipe, k, v)
    return recipe


def compute_channel_state_hash(resolved_recipe: dict[str, Any], pkg_dir: Path) -> str:
    """Computes a deterministic content-addressable hash for a specific resolved channel."""
    hasher = hashlib.sha256()

    hashable_dict = {
        "name": resolved_recipe.get("name"),
        "version": resolved_recipe.get("version"),
        "revision": resolved_recipe.get("revision"),
        "channel": resolved_recipe.get("channel"),
        "arch": resolved_recipe.get("arch"),
        "source_url": resolved_recipe.get("source_url"),
        "build_deps": sorted(resolved_recipe.get("build_deps", [])),
        "deps": sorted(resolved_recipe.get("deps", [])),
        "phases": resolved_recipe.get("phases", {}),
        "env": resolved_recipe.get("env", {}),
    }
    hasher.update(json.dumps(hashable_dict, sort_keys=True).encode("utf-8"))

    patches = resolved_recipe.get("patches", [])
    for patch_rel in patches:
        patch_path = pkg_dir / patch_rel
        if patch_path.exists():
            hasher.update(patch_path.read_bytes())

    return hasher.hexdigest()[:16]
