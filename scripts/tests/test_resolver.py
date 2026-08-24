from pathlib import Path

from core.resolver import (
    compute_channel_state_hash,
    resolve_channel_recipe,
)


def test_channel_overlay_and_interpolation():
    raw_recipe = {
        "name": "bun",
        "version": "1.4.0",
        "revision": 0,
        "build_deps": ["clang"],
        "phases": {
            "make": "echo make",
            "test": "echo base test",
        },
        "channels": {
            "latest": {
                "source_url": "https://github.com/oven-sh/bun/releases/download/bun-v{version}/bun-linux-{arch}.zip",
                "extra_build_deps": ["llvm"],
            },
            "canary": {
                "version": "1.4.1-canary.1",
                "source_url": "https://github.com/oven-sh/bun/releases/download/canary-{version}/bun.zip",
                "phases": {
                    "test": "echo canary test",
                },
            },
        },
    }

    # Test latest channel overlay
    latest = resolve_channel_recipe(raw_recipe, "latest")
    assert (
        latest["source_url"]
        == "https://github.com/oven-sh/bun/releases/download/bun-v1.4.0/bun-linux-aarch64.zip"
    )
    assert latest["build_deps"] == ["clang", "llvm"]
    assert latest["phases"]["test"] == "echo base test"

    # Test canary channel overlay
    canary = resolve_channel_recipe(raw_recipe, "canary")
    assert canary["version"] == "1.4.1-canary.1"
    assert (
        canary["source_url"]
        == "https://github.com/oven-sh/bun/releases/download/canary-1.4.1-canary.1/bun.zip"
    )
    assert canary["phases"]["test"] == "echo canary test"
    assert canary["phases"]["make"] == "echo make"


def test_channel_state_hash(tmp_path: Path):
    resolved = {
        "name": "testpkg",
        "version": "1.0.0",
        "revision": 0,
        "channel": "latest",
        "arch": "aarch64",
        "source_url": "https://example.com/src.tar.gz",
        "build_deps": ["make"],
        "deps": [],
        "phases": {"make": "make"},
        "env": {},
        "patches": [],
    }
    hash1 = compute_channel_state_hash(resolved, tmp_path)
    assert len(hash1) == 16

    resolved_canary = dict(resolved)
    resolved_canary["channel"] = "canary"
    hash2 = compute_channel_state_hash(resolved_canary, tmp_path)
    assert hash1 != hash2
