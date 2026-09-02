from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any


def _to_dict(obj: Any) -> dict[str, Any]:
    """Safely converts dicts, Pydantic models, dataclasses, and custom objects to raw dicts."""
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return {k: copy.deepcopy(v) for k, v in obj.items() if v is not None}

    # Handle Pydantic v2 / Custom model_dump()
    if hasattr(obj, "model_dump") and callable(obj.model_dump):
        try:
            res = obj.model_dump(exclude_none=True)
        except TypeError:
            res = obj.model_dump()
        if isinstance(res, dict):
            return {k: copy.deepcopy(v) for k, v in res.items() if v is not None}

    # Handle Pydantic v1 / Custom dict()
    if hasattr(obj, "dict") and callable(obj.dict):
        try:
            res = obj.dict(exclude_none=True)
        except TypeError:
            res = obj.dict()
        if isinstance(res, dict):
            return {k: copy.deepcopy(v) for k, v in res.items() if v is not None}

    # Handle generic Python class instances / Dataclasses
    if hasattr(obj, "__dict__"):
        return {
            k: copy.deepcopy(v)
            for k, v in vars(obj).items()
            if not k.startswith("_") and v is not None
        }

    return {}


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
    raw_recipe: Any, channel_name: str = "latest"
) -> dict[str, Any]:
    """Resolves and flattens a recipe dictionary or model for a targeted release channel."""
    base_data = _to_dict(raw_recipe)
    channels_map = base_data.pop("channels", {})
    if not isinstance(channels_map, dict):
        channels_map = _to_dict(channels_map)

    channel_raw = channels_map.get(channel_name, {})
    channel_cfg = (
        _to_dict(channel_raw) if not isinstance(channel_raw, dict) else channel_raw
    )

    resolved = copy.deepcopy(base_data)
    resolved["channel"] = channel_name

    for key, val in channel_cfg.items():
        if val is None:
            continue
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
    raw_dict = _to_dict(recipe)
    resolved_dict = resolve_channel_recipe(raw_dict, channel_name)

    if isinstance(recipe, dict):
        recipe.clear()
        recipe.update(resolved_dict)
        return recipe

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
        "source": resolved_recipe.get("source"),
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

    if pkg_dir and pkg_dir.exists() and pkg_dir.is_dir():
        for item in sorted(pkg_dir.rglob("*")):
            if item.is_file() and item.name != "pkg.yml":
                rel_path = item.relative_to(pkg_dir).as_posix()
                hasher.update(rel_path.encode("utf-8"))
                hasher.update(item.read_bytes())

    return hasher.hexdigest()[:16]
