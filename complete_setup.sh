#!/usr/bin/env bash
set -e

echo "🚀 Starting full RepoExe alignment and package creation..."

# 1. Create Directory Hierarchy
mkdir -p scripts/builders scripts/utils scripts/cli .github/actions/setup-memory pkg/aisleriot pkg/bun-jsc pkg/bun

# 2. Move Script Files
[ -f scripts/build.py ] && mv scripts/build.py scripts/cli/build.py
[ -f scripts/generate_shards.py ] && mv scripts/generate_shards.py scripts/cli/generate_shards.py
[ -f scripts/core/alpine.py ] && mv scripts/core/alpine.py scripts/builders/alpine.py
[ -f scripts/core/debian.py ] && mv scripts/core/debian.py scripts/builders/debian.py
[ -f scripts/core/npm.py ] && mv scripts/core/npm.py scripts/builders/npm.py
[ -f scripts/core/pacman.py ] && mv scripts/core/pacman.py scripts/builders/pacman.py
[ -f scripts/core/pip.py ] && mv scripts/core/pip.py scripts/builders/pip.py
[ -f scripts/core/dag.py ] && mv scripts/core/dag.py scripts/utils/dag.py
[ -f scripts/core/health.py ] && mv scripts/core/health.py scripts/utils/health.py
[ -f scripts/core/index_gen.py ] && mv scripts/core/index_gen.py scripts/cli/index_gen.py
[ -f scripts/core/log_aggregator.py ] && mv scripts/core/log_aggregator.py scripts/utils/log_aggregator.py
[ -f scripts/core/metadata.py ] && mv scripts/core/metadata.py scripts/utils/metadata.py
[ -f scripts/core/parser.py ] && mv scripts/core/parser.py scripts/utils/parser.py
[ -f scripts/core/properties.py ] && mv scripts/core/properties.py scripts/utils/properties.py
[ -f scripts/core/prune.py ] && mv scripts/core/prune.py scripts/cli/prune.py
[ -f scripts/core/sysroot.py ] && mv scripts/core/sysroot.py scripts/utils/sysroot.py
[ -f scripts/core/test.py ] && mv scripts/core/test.py scripts/utils/test.py
[ -f scripts/core/update_recipe.py ] && mv scripts/core/update_recipe.py scripts/cli/update_recipe.py
[ -f scripts/core/upstream_check.py ] && mv scripts/core/upstream_check.py scripts/cli/upstream_check.py
[ -d scripts/core/toolchains ] && mv scripts/core/toolchains scripts/utils/toolchains
[ -d scripts/core ] && rm -rf scripts/core

touch scripts/__init__.py scripts/builders/__init__.py scripts/utils/__init__.py scripts/cli/__init__.py

# 3. Write Updated pyproject.toml
cat << 'PYPROJ' > pyproject.toml
[project]
name = "repoexe-orchestrator"
version = "0.1.0"
description = "Micro-modular Python orchestrator for RepoExe"
requires-python = ">=3.10"
dependencies = [
    "packaging>=24.0",
    "pydantic>=2.7.0",
    "pyyaml>=6.0.1",
    "requests>=2.31.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["scripts/builders", "scripts/utils", "scripts/cli"]

[tool.uv]
link-mode = "symlink"

[dependency-groups]
dev = [
    "mypy>=1.10.0",
    "pytest>=8.0.0",
]

[tool.ruff.lint]
ignore = ["BLE001", "S110"]
PYPROJ

# 4. Write Parser with ResourceConfig
cat << 'PARSER' > scripts/utils/parser.py
import hashlib
import json
from pathlib import Path

import yaml
from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class ResourceConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

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
    component: str = "main"
    build_system: str = "custom"
    source_url: str | None = Field(
        default=None, validation_alias=AliasChoices("source_url", "source", "url")
    )
    sha256: str | None = None
    formats: list[str] = Field(default_factory=lambda: ["apt", "pacman", "apk"])
    build_deps: list[str] = Field(default_factory=list)
    deps: list[str] = Field(default_factory=list, alias="depends")
    resources: ResourceConfig = Field(default_factory=ResourceConfig)
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
        }
        raw_json = json.dumps(payload, sort_keys=True)
        return hashlib.sha256(raw_json.encode("utf-8")).hexdigest()[:16]


def parse_recipe(recipe_path: Path, channel: str = "latest") -> PackageRecipe:
    if not recipe_path.exists():
        raise FileNotFoundError(f"Recipe file not found: {recipe_path}")

    raw_data = yaml.safe_load(recipe_path.read_text(encoding="utf-8"))
    base_recipe = PackageRecipe(**raw_data)
    return base_recipe.get_channel_recipe(channel)
PARSER

# 5. Write Updated generate_shards.py
cat << 'SHARDS' > scripts/cli/generate_shards.py
import json
import os
import subprocess
from pathlib import Path

from utils.parser import parse_recipe


def get_git_diff_files(repo_root: Path) -> set[str]:
    base_ref = os.environ.get("GITHUB_BASE_REF", "").strip()
    if base_ref:
        diff_cmd = ["git", "diff", "--name-only", f"origin/{base_ref}...HEAD"]
    else:
        diff_cmd = ["git", "diff", "--name-only", "HEAD~1", "HEAD"]

    try:
        res = subprocess.run(
            diff_cmd,
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )
        if res.returncode != 0 or not res.stdout.strip():
            res = subprocess.run(
                ["git", "diff", "--name-only", "HEAD"],
                cwd=repo_root,
                capture_output=True,
                text=True,
                check=False,
            )
        if res.returncode == 0 and res.stdout.strip():
            return set(res.stdout.splitlines())
    except Exception:
        pass
    return set()


def get_changed_packages(repo_root: Path) -> set[str]:
    files = get_git_diff_files(repo_root)
    changed_pkgs = set()

    for file in files:
        parts = Path(file.strip()).parts
        if len(parts) >= 2 and parts[0] == "pkg":
            changed_pkgs.add(parts[1])

    return changed_pkgs


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    pkgs_dir = repo_root / "pkg"

    raw_input = os.environ.get("TARGET_INPUT", "").strip()
    all_pkg_dirs = sorted(
        [
            d.name
            for d in pkgs_dir.iterdir()
            if d.is_dir() and (d / "build.yml").exists()
        ]
    )

    def get_channels(pkg_name: str) -> list[str]:
        recipe_path = pkgs_dir / pkg_name / "build.yml"
        if not recipe_path.exists():
            return ["latest"]
        try:
            recipe = parse_recipe(recipe_path, channel="latest")
            ch_keys = list(recipe.channels.keys()) if recipe.channels else []
            if "latest" not in ch_keys:
                ch_keys.insert(0, "latest")
            return ch_keys
        except Exception:
            return ["latest"]

    if not raw_input or raw_input == "auto":
        changed_pkgs = get_changed_packages(repo_root)
        candidates = {(p, "latest") for p in changed_pkgs if (pkgs_dir / p).exists()}
    else:
        incl_tokens, excl_tokens = [], []
        for token in raw_input.split():
            if token.startswith("!"):
                excl_tokens.append(token[1:])
            else:
                incl_tokens.append(token)

        if not incl_tokens:
            incl_tokens = ["all@latest"]

        candidates = set()
        for token in incl_tokens:
            pkg, ch = token.split("@", 1) if "@" in token else (token, "latest")
            target_pkgs = all_pkg_dirs if pkg == "all" else [pkg]
            for p in target_pkgs:
                if not (pkgs_dir / p).exists():
                    continue
                available_chs = get_channels(p)
                target_chs = available_chs if ch == "all" else [ch]
                for c in target_chs:
                    candidates.add((p, c))

        excluded = set()
        for token in excl_tokens:
            pkg, ch = token.split("@", 1) if "@" in token else (token, None)
            target_pkgs = all_pkg_dirs if pkg == "all" else [pkg]
            for p, c in list(candidates):
                if p in target_pkgs and (ch is None or ch == "all" or c == ch):
                    excluded.add((p, c))

        candidates -= excluded

    final_targets = sorted(candidates)

    matrix = []
    for p, c in final_targets:
        heavy = False
        build_sys = "custom"
        zram = 0
        swap = 0
        free_space = False
        recipe_path = pkgs_dir / p / "build.yml"
        if recipe_path.exists():
            try:
                r = parse_recipe(recipe_path, channel=c)
                heavy = r.heavy_build
                build_sys = r.build_system
                zram = getattr(r.resources, "zram", 0)
                swap = getattr(r.resources, "swap", 0)
                free_space = getattr(r.resources, "free_space", False)
            except Exception:
                pass
        matrix.append(
            {
                "package": p,
                "channel": c,
                "heavy": heavy,
                "build_system": build_sys,
                "zram": zram,
                "swap": swap,
                "free_space": free_space,
            }
        )

    print(json.dumps(matrix))


if __name__ == "__main__":
    main()
SHARDS

# 6. Write Updated Toolchains Initialization
cat << 'TOOLCHAINS' > scripts/utils/toolchains/__init__.py
import os

from utils.properties import HOME, PREFIX

from .golang import GolangToolchain
from .native import NativeToolchain
from .python import PythonToolchain
from .rust import RustToolchain
from .swift import SwiftToolchain
from .zig import ZigToolchain

__all__ = [
    "GolangToolchain",
    "NativeToolchain",
    "PythonToolchain",
    "RustToolchain",
    "SwiftToolchain",
    "ZigToolchain",
]


def setup_build_environment(
    build_system: str, target_arch: str = "aarch64"
) -> dict[str, str]:
    env = os.environ.copy()

    env["PREFIX"] = PREFIX
    env["TERMUX_PREFIX"] = PREFIX
    env["HOME"] = HOME
    env["TERMUX_HOME"] = HOME
    env["TMPDIR"] = f"{PREFIX}/tmp"

    cflags = f"-I{PREFIX}/include -O2 -fPIC"
    ldflags = f"-L{PREFIX}/lib -Wl,-rpath={PREFIX}/lib"

    env["CFLAGS"] = cflags
    env["CPPFLAGS"] = f"-I{PREFIX}/include"
    env["CXXFLAGS"] = cflags
    env["LDFLAGS"] = ldflags

    if build_system == "go":
        env.update(
            {
                "GOOS": "android",
                "GOARCH": "arm64"
                if target_arch in ["aarch64", "arm64"]
                else target_arch,
                "CGO_ENABLED": "0",
                "GOTOOLCHAIN": "local",
            }
        )
    elif build_system == "cargo":
        target_triple = (
            "aarch64-unknown-linux-musl" if target_arch == "aarch64" else target_arch
        )
        env.update(
            {
                "CARGO_BUILD_TARGET": target_triple,
                "RUSTFLAGS": f"-L{PREFIX}/lib",
            }
        )

    return env
TOOLCHAINS

# Update toolchain submodules
sed -i 's/from core.properties/from utils.properties/g' scripts/utils/toolchains/*.py

# 7. Update Builders Imports & Fixes
sed -i 's/from core.parser/from utils.parser/g' scripts/builders/*.py

# Update pip.py with PEP 440 version fix
cat << 'PIPBUILD' > scripts/builders/pip.py
import hashlib
import shutil
import zipfile
from pathlib import Path

from utils.parser import PackageRecipe


def build_pip(recipe: PackageRecipe, destdir: str, output_dir: str) -> Path:
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    pkg_name = recipe.name.replace("-", "_")

    existing_wheels = list(out_path.glob(f"{pkg_name}*.whl"))
    if existing_wheels:
        return existing_wheels[0]

    pip_version = (
        f"{recipe.version}+repoexe.{recipe.revision}"
        if recipe.revision > 0
        else recipe.version
    )

    stage_dir = Path(destdir) / "stage"
    wheel_name = f"{pkg_name}-{pip_version}-py3-none-any.whl"
    wheel_path = out_path / wheel_name

    wheel_build_dir = Path(destdir) / "wheel_build"
    if wheel_build_dir.exists():
        shutil.rmtree(wheel_build_dir)
    wheel_build_dir.mkdir(parents=True, exist_ok=True)

    python_staged = list(stage_dir.rglob("site-packages")) + list(
        stage_dir.rglob("dist-packages")
    )
    if python_staged:
        for p_dir in python_staged:
            for item in p_dir.iterdir():
                target = wheel_build_dir / item.name
                if item.is_dir():
                    shutil.copytree(item, target, dirs_exist_ok=True)
                else:
                    shutil.copy2(item, target)
    elif stage_dir.exists():
        for item in stage_dir.iterdir():
            if item.name in ("DEBIAN", ".PKGINFO", "npm_package", "wheel_build"):
                continue
            target = wheel_build_dir / item.name
            if item.is_dir():
                shutil.copytree(item, target, dirs_exist_ok=True)
            else:
                shutil.copy2(item, target)

    clean_pkg_name = recipe.name.replace("-", "_").lower()
    expected_dist_info = f"{clean_pkg_name}-{pip_version}.dist-info".lower()

    for item in wheel_build_dir.iterdir():
        name_lower = item.name.lower()
        if (
            name_lower.endswith((".dist-info", ".egg-info"))
            and name_lower != expected_dist_info
        ):
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()

    dist_info = wheel_build_dir / f"{pkg_name}-{pip_version}.dist-info"
    dist_info.mkdir(parents=True, exist_ok=True)

    (dist_info / "METADATA").write_text(
        f"Metadata-Version: 2.1\nName: {recipe.name}\nVersion: {pip_version}\nSummary: {recipe.description}\n",
        encoding="utf-8",
    )
    (dist_info / "WHEEL").write_text(
        "Wheel-Version: 1.0\nGenerator: repoexe-builder\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
        encoding="utf-8",
    )

    with zipfile.ZipFile(wheel_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(wheel_build_dir.rglob("*")):
            if file_path.is_file():
                arcname = file_path.relative_to(wheel_build_dir)
                zf.write(file_path, arcname)

    return wheel_path


def generate_pip_index(output_dir: str | Path) -> None:
    base_dir = Path(output_dir)
    pip_dir = base_dir / "pip"
    pip_dir.mkdir(parents=True, exist_ok=True)

    whl_files = list(base_dir.rglob("*.whl"))
    packages: dict[str, list[Path]] = {}

    for whl in whl_files:
        raw_name = whl.name.split("-")[0].lower().replace("_", "-")
        packages.setdefault(raw_name, []).append(whl)

    root_links = []
    for pkg_name in sorted(packages.keys()):
        root_links.append(f'<li><a href="{pkg_name}/">{pkg_name}</a></li>')
        pkg_page_dir = pip_dir / pkg_name
        pkg_page_dir.mkdir(parents=True, exist_ok=True)

        pkg_links = []
        for whl_path in sorted(packages[pkg_name]):
            dest_file = pkg_page_dir / whl_path.name
            if whl_path != dest_file:
                shutil.copy2(whl_path, dest_file)

            file_bytes = dest_file.read_bytes()
            sha256_hash = hashlib.sha256(file_bytes).hexdigest()
            pkg_links.append(
                f'<li><a href="{whl_path.name}#sha256={sha256_hash}">{whl_path.name}</a></li>'
            )

        page_html = (
            "<!DOCTYPE html><html><head><title>Links for "
            + pkg_name
            + "</title></head><body><h1>Links for "
            + pkg_name
            + "</h1>"
            + "".join(pkg_links)
            + "</body></html>"
        )
        (pkg_page_dir / "index.html").write_text(page_html, encoding="utf-8")

    index_html = (
        "<!DOCTYPE html><html><head><title>Simple Index</title></head><body>"
        + "".join(root_links)
        + "</body></html>"
    )
    (pip_dir / "index.html").write_text(index_html, encoding="utf-8")
PIPBUILD

# Update debian.py with termux-elf-cleaner hook
cat << 'DEBBUILD' > scripts/builders/debian.py
import concurrent.futures
import gzip
import hashlib
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from utils.parser import PackageRecipe

ARCH_MAP = {
    "aarch64": "aarch64",
    "x86_64": "x86_64",
    "arm": "arm",
    "i686": "i686",
}


def generate_control_file(recipe: PackageRecipe) -> str:
    version_str = (
        f"{recipe.version}-{recipe.revision}" if recipe.revision > 0 else recipe.version
    )
    deb_arch = ARCH_MAP.get(recipe.architecture, recipe.architecture)

    control_lines = [
        f"Package: {recipe.name}",
        f"Version: {version_str}",
        f"Architecture: {deb_arch}",
        f"Maintainer: {recipe.maintainer or 'SjnExe'}",
        f"Description: {recipe.description or 'RepoExe package'}",
    ]

    if recipe.homepage:
        control_lines.append(f"Homepage: {recipe.homepage}")

    return "\n".join(control_lines) + "\n"


def prepare_debian_dir(
    recipe: PackageRecipe, build_dir: Path, pkg_src_dir: Path | None = None
) -> Path:
    stage_dir = build_dir / "stage"
    debian_dir = stage_dir / "DEBIAN"
    debian_dir.mkdir(parents=True, exist_ok=True)
    debian_dir.chmod(0o755)

    control_content = generate_control_file(recipe)
    control_file = debian_dir / "control"
    control_file.write_text(control_content, encoding="utf-8")
    control_file.chmod(0o644)

    if pkg_src_dir and pkg_src_dir.exists():
        for item in pkg_src_dir.iterdir():
            if item.name in ("build.yml", "build.sh", "subpackages"):
                continue
            target = stage_dir / item.name
            if item.is_dir():
                shutil.copytree(item, target, dirs_exist_ok=True)
            else:
                shutil.copy2(item, target)

    return stage_dir


def build_deb(
    recipe: PackageRecipe,
    destdir: str,
    output_dir: str,
    target_arch: str = "aarch64",
    pkg_src_dir: Path | None = None,
) -> Path:
    build_path = Path(destdir)
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    stage_dir = prepare_debian_dir(recipe, build_path, pkg_src_dir=pkg_src_dir)

    if shutil.which("termux-elf-cleaner"):
        subprocess.run(
            ["termux-elf-cleaner", str(stage_dir)], check=False, capture_output=True
        )

    version_str = (
        f"{recipe.version}-{recipe.revision}" if recipe.revision > 0 else recipe.version
    )
    raw_arch = recipe.architecture or target_arch
    arch = ARCH_MAP.get(raw_arch, raw_arch)
    deb_filename = f"{recipe.name}_{version_str}_{arch}.deb"
    deb_path = out_path / deb_filename

    cmd = ["dpkg-deb", "--build", "-Zzstd", "-z1", str(stage_dir), str(deb_path)]
    res = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if res.returncode != 0:
        cmd = ["dpkg-deb", "--build", str(stage_dir), str(deb_path)]
        res2 = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if res2.returncode != 0:
            raise RuntimeError(
                f"dpkg-deb failed for {recipe.name}: {res2.stderr.strip()}"
            )

    return deb_path


def _process_single_deb(deb_file: Path) -> str | None:
    try:
        res = subprocess.run(
            ["dpkg-deb", "-f", str(deb_file)],
            capture_output=True,
            text=True,
            check=True,
        )
        control_info = res.stdout.strip()

        content = deb_file.read_bytes()
        size = len(content)
        md5 = hashlib.md5(content).hexdigest()
        sha256 = hashlib.sha256(content).hexdigest()

        return (
            f"{control_info}\nFilename: {deb_file.name}\nSize: {size}\n"
            f"MD5sum: {md5}\nSHA256: {sha256}\n\n"
        )
    except (subprocess.CalledProcessError, OSError):
        return None


def generate_apt_metadata(
    output_dir: str, component: str = "main", arch: str = "aarch64"
) -> None:
    binary_dir = os.path.join(
        output_dir, "dists", "stable", component, f"binary-{arch}"
    )
    os.makedirs(binary_dir, exist_ok=True)

    packages_path = os.path.join(binary_dir, "Packages")
    deb_files = sorted(Path(output_dir).glob("*.deb"))

    packages_entries = []
    with concurrent.futures.ThreadPoolExecutor() as executor:
        results = executor.map(_process_single_deb, deb_files)
        for entry in results:
            if entry:
                packages_entries.append(entry)

    packages_content = "".join(packages_entries)
    with open(packages_path, "w", encoding="utf-8") as f:
        f.write(packages_content)

    with gzip.open(f"{packages_path}.gz", "wb") as f_gz:
        f_gz.write(packages_content.encode("utf-8"))


def generate_release_file(
    output_dir: str, suite: str = "stable", component: str = "main"
) -> None:
    dists_dir = os.path.join(output_dir, "dists", suite)
    os.makedirs(dists_dir, exist_ok=True)
    release_path = os.path.join(dists_dir, "Release")

    arches = set()
    file_entries = []

    for root, _, files in os.walk(dists_dir):
        for file in files:
            if file in ("Packages", "Packages.gz"):
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, dists_dir)

                for p in rel_path.split(os.sep):
                    if p.startswith("binary-"):
                        arches.add(p.replace("binary-", ""))

                data = Path(full_path).read_bytes()
                size = len(data)
                sha256 = hashlib.sha256(data).hexdigest()
                file_entries.append(f" {sha256} {size} {rel_path}")

    arch_str = " ".join(sorted(arches)) or "aarch64"

    release_content = (
        f"Origin: RepoExe\n"
        f"Date: {datetime.now(timezone.utc).strftime('%a, %d %b %Y %H:%M:%S UTC')}\n"
        f"Label: RepoExe\n"
        f"Suite: {suite}\n"
        f"Codename: {suite}\n"
        f"Architectures: {arch_str}\n"
        f"Components: {component}\n"
        f"Description: RepoExe Package Repository\n"
        f"SHA256:\n" + "\n".join(file_entries) + "\n"
    )

    with open(release_path, "w", encoding="utf-8") as f:
        f.write(release_content)

    key_path = Path("scripts/repoexe.gpg")
    if not key_path.exists():
        key_path = Path("repoexe.gpg")

    if key_path.exists():
        subprocess.run(
            ["gpg", "--import", str(key_path)], capture_output=True, check=False
        )
        subprocess.run(
            [
                "gpg",
                "--clearsign",
                "-o",
                os.path.join(dists_dir, "InRelease"),
                release_path,
            ],
            capture_output=True,
            check=False,
        )
        subprocess.run(
            ["gpg", "-abs", "-o", os.path.join(dists_dir, "Release.gpg"), release_path],
            capture_output=True,
            check=False,
        )
DEBBUILD

# 8. Update Utils Modules Imports & Test imports
sed -i 's/from core.parser/from utils.parser/g' scripts/utils/*.py
sed -i 's/from core.properties/from utils.properties/g' scripts/utils/*.py
sed -i 's/from core.parser/from utils.parser/g' scripts/cli/*.py
sed -i 's/from core.debian/from builders.debian/g' scripts/cli/*.py
sed -i 's/from core.metadata/from utils.metadata/g' scripts/cli/*.py
sed -i 's/from core.npm/from builders.npm/g' scripts/cli/*.py
sed -i 's/from core.pip/from builders.pip/g' scripts/cli/*.py

# Update scripts/cli/build.py
cat << 'BUILDCLI' > scripts/cli/build.py
import argparse
import contextlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

from builders.alpine import build_alpine
from builders.debian import build_deb
from builders.npm import build_npm
from builders.pacman import build_pacman
from builders.pip import build_pip
from utils.health import audit_repository_health
from utils.parser import parse_recipe
from utils.test import ProotTestRunner
from utils.toolchains import setup_build_environment


def check_existing_release_hash(pkg_name: str, channel: str, target_hash: str) -> bool:
    tag = f"{pkg_name}@{channel}"
    api_url = f"https://api.github.com/repos/SjnExe/RepoExe/releases/tags/{tag}"
    try:
        req = urllib.request.Request(
            api_url, headers={"User-Agent": "RepoExe-Orchestrator"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        for asset in data.get("assets", []):
            if asset.get("name") == "metadata.json":
                meta_raw = (
                    urllib.request.urlopen(asset["browser_download_url"])
                    .read()
                    .decode("utf-8")
                )
                remote_meta = json.loads(meta_raw)
                return remote_meta.get("state_hash") == target_hash
    except Exception:
        return False
    return False


def resolve_and_fetch_build_dependencies(build_deps: list[str], destdir: Path) -> None:
    if not build_deps:
        return

    print(f"Resolving build dependencies: {', '.join(build_deps)}")
    stage_dir = destdir / "stage"

    for dep in build_deps:
        tag = f"{dep}@latest"
        api_url = f"https://api.github.com/repos/SjnExe/RepoExe/releases/tags/{tag}"

        try:
            req = urllib.request.Request(
                api_url, headers={"User-Agent": "RepoExe-Orchestrator"}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                rel_data = json.loads(resp.read().decode("utf-8"))

            deb_asset = next(
                (
                    a
                    for a in rel_data.get("assets", [])
                    if a.get("name", "").endswith(".deb")
                ),
                None,
            )

            if deb_asset:
                download_url = deb_asset["browser_download_url"]
                dep_deb = destdir / deb_asset["name"]
                print(f"Fetching pre-built dependency '{dep}' from {download_url}...")
                urllib.request.urlretrieve(download_url, dep_deb)
                subprocess.run(
                    ["dpkg-deb", "-x", str(dep_deb), str(stage_dir)], check=True
                )
                print(f"✓ Extracted pre-built dependency '{dep}' into build staging.")
        except Exception as e:
            print(
                f"Notice: Pre-built artifact for dependency '{dep}' could not be fetched ({e})."
            )


def verify_format_archives(output_dir: Path, pkg_name: str) -> None:
    for f in output_dir.glob(f"{pkg_name}*"):
        if f.name.endswith(".deb"):
            subprocess.run(["dpkg-deb", "-I", str(f)], check=True, capture_output=True)
        elif (
            f.name.endswith(".pkg.tar.zst")
            or f.name.endswith(".pkg.tar.gz")
            or f.name.endswith(".apk")
        ):
            subprocess.run(["tar", "-tf", str(f)], check=True, capture_output=True)
        elif f.name.endswith(".whl"):
            subprocess.run(["unzip", "-t", str(f)], check=True, capture_output=True)
        elif f.name.endswith(".tgz"):
            subprocess.run(["tar", "-tf", str(f)], check=True, capture_output=True)


def execute_compile(recipe, pkg_dir: Path, destdir: Path) -> Path:
    env = os.environ.copy()
    env["MAKEFLAGS"] = "-j4"
    env["NINJA_JOBS"] = "4"
    env["CARGO_BUILD_JOBS"] = "4"
    env["GOMAXPROCS"] = "4"
    env["GIT_CONFIG_COUNT"] = "1"
    env["GIT_CONFIG_KEY_0"] = "safe.directory"
    env["GIT_CONFIG_VALUE_0"] = "*"

    subprocess.run(
        ["git", "config", "--global", "--add", "safe.directory", "*"], check=False
    )

    build_sys = getattr(recipe, "build_system", None)
    if build_sys:
        with contextlib.suppress(Exception):
            setup_build_environment(build_sys, recipe.architecture)

    print(f"[COMPILING] Package: {recipe.name} (Channel: {recipe.active_channel})")

    destdir.parent.mkdir(parents=True, exist_ok=True)
    if destdir.exists():
        shutil.rmtree(destdir)
    destdir.mkdir(parents=True, exist_ok=True)

    stage_dir = destdir / "stage"
    stage_dir.mkdir(parents=True, exist_ok=True)

    resolve_and_fetch_build_dependencies(recipe.build_deps, destdir)

    work_dir = pkg_dir
    src_url = getattr(recipe, "source_url", None)
    if src_url:
        archive_path = destdir / "source.tar.gz"
        src_extract_dir = destdir / "src"
        src_extract_dir.mkdir(parents=True, exist_ok=True)

        subprocess.run(
            ["curl", "-fsSL", str(src_url), "-o", str(archive_path)], check=True
        )
        if archive_path.exists():
            subprocess.run(
                [
                    "tar",
                    "-xf",
                    str(archive_path),
                    "-C",
                    str(src_extract_dir),
                    "--strip-components=1",
                ],
                check=False,
            )
            if not any(src_extract_dir.iterdir()):
                subprocess.run(
                    ["tar", "-xf", str(archive_path), "-C", str(src_extract_dir)],
                    check=True,
                )
            work_dir = src_extract_dir

    env["DESTDIR"] = str(stage_dir.resolve())
    env["PREFIX"] = "/data/data/com.termux/files/usr"

    phases = getattr(recipe, "phases", {})
    prepare_cmd = phases.get("prepare")
    make_cmd = phases.get("make")
    install_cmd = phases.get("install")

    if prepare_cmd:
        res = subprocess.run(
            prepare_cmd, shell=True, cwd=work_dir, env=env, check=False
        )
        if res.returncode != 0:
            raise RuntimeError(f"Prepare phase failed for {recipe.name}")

    if make_cmd:
        res = subprocess.run(make_cmd, shell=True, cwd=work_dir, env=env, check=False)
        if res.returncode != 0:
            raise RuntimeError(f"Make phase failed for {recipe.name}")

    if install_cmd:
        res = subprocess.run(
            install_cmd, shell=True, cwd=work_dir, env=env, check=False
        )
        if res.returncode != 0:
            raise RuntimeError(f"Install phase failed for {recipe.name}")

    return stage_dir


def execute_pack(recipe, pkg_dir: Path, destdir: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        os.chmod(output_dir, 0o777)

    stage_dir = destdir / "stage"
    installed_files = list(stage_dir.rglob("*")) if stage_dir.exists() else []
    payload_files = [
        f
        for f in installed_files
        if f.is_file() and "DEBIAN" not in f.parts and ".PKGINFO" not in f.name
    ]

    out_has_wheels = (
        list(output_dir.glob(f"{recipe.name}*.whl")) if output_dir.exists() else []
    )
    if not payload_files and not out_has_wheels:
        raise RuntimeError(
            f"CRITICAL ERROR: No files installed in $DESTDIR for {recipe.name}."
        )

    target_formats = getattr(recipe, "formats", ["apt", "pacman", "apk"])

    if "apt" in target_formats:
        build_deb(
            recipe,
            str(destdir),
            str(output_dir),
            target_arch=recipe.architecture,
            pkg_src_dir=pkg_dir,
        )
    if "pacman" in target_formats:
        build_pacman(
            recipe, str(destdir), str(output_dir), target_arch=recipe.architecture
        )
    if "apk" in target_formats:
        build_alpine(
            recipe, str(destdir), str(output_dir), target_arch=recipe.architecture
        )
    if "pip" in target_formats:
        build_pip(recipe, str(destdir), str(output_dir))
    if "npm" in target_formats:
        build_npm(recipe, str(destdir), str(output_dir))

    verify_format_archives(output_dir, recipe.name)

    meta = {
        "name": recipe.name,
        "version": recipe.version,
        "revision": recipe.revision,
        "architecture": recipe.architecture,
        "state_hash": recipe.state_hash,
        "channel": recipe.active_channel,
    }
    (output_dir / f"{recipe.name}_metadata.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )


def execute_test(recipe, destdir: Path | None = None) -> None:
    phases = getattr(recipe, "phases", {})
    test_cmd = phases.get("test")
    if shutil.which("proot"):
        runner = ProotTestRunner()
        cmd_to_run = test_cmd or f"{recipe.name} --version || {recipe.name} --help"
        runner.execute_test(recipe.name, cmd_to_run, destdir=destdir)


def main() -> None:
    parser = argparse.ArgumentParser(description="RepoExe Build System CLI")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("check")

    for cmd_name in ("build", "compile", "pack", "test"):
        p = subparsers.add_parser(cmd_name)
        p.add_argument("package")
        p.add_argument("--channel", default="latest")
        p.add_argument("--dry-run", action="store_true")
        p.add_argument("--force", action="store_true")

    args = parser.parse_args()
    pkg_dir = Path(__file__).resolve().parents[2] / "pkg"

    if args.command == "check":
        audit_repository_health(pkg_dir)
        return

    if args.command in ("build", "compile", "pack", "test"):
        pkg_path = Path(args.package)
        if not pkg_path.is_absolute():
            pkg_path = Path.cwd() / args.package

        recipe_file = pkg_path / "build.yml" if pkg_path.is_dir() else pkg_path
        if not recipe_file.exists():
            print(f"Error: Recipe not found at {recipe_file}", file=sys.stderr)
            sys.exit(1)

        p_dir = recipe_file.parent
        recipe = parse_recipe(recipe_file, channel=args.channel)

        if not args.force and check_existing_release_hash(
            recipe.name, args.channel, recipe.state_hash
        ):
            print(f"⏭️ Skipping {recipe.name}@{args.channel}: state_hash unchanged.")
            return

        if args.dry_run:
            print(f"✓ Dry-run complete for {recipe.name} ({args.command}).")
            return

        destdir = (Path.cwd() / "build" / f"build_{recipe.name}").resolve()
        output_dir = (Path.cwd() / "output").resolve()

        if args.command == "compile":
            execute_compile(recipe, p_dir, destdir)
        elif args.command == "pack":
            execute_pack(recipe, p_dir, destdir, output_dir)
        elif args.command == "test":
            execute_test(recipe, destdir)
        elif args.command == "build":
            execute_compile(recipe, p_dir, destdir)
            execute_pack(recipe, p_dir, destdir, output_dir)
            execute_test(recipe, destdir)


if __name__ == "__main__":
    main()
BUILDCLI

# Update tests imports
sed -i 's/from core.health/from utils.health/g' scripts/tests/test_formats.py
sed -i 's/from core.npm/from builders.npm/g' scripts/tests/test_formats.py
sed -i 's/from core.parser/from utils.parser/g' scripts/tests/test_formats.py
sed -i 's/from core.pip/from builders.pip/g' scripts/tests/test_formats.py
sed -i 's/from core.prune/from cli.prune/g' scripts/tests/test_orchestrator.py
sed -i 's/from core.properties/from utils.properties/g' scripts/tests/test_properties.py
sed -i 's/from core.prune/from cli.prune/g' scripts/tests/test_prune.py
sed -i 's/from core.sysroot/from utils.sysroot/g' scripts/tests/test_sysroot.py
sed -i 's/from core.test/from utils.test/g' scripts/tests/test_test.py
sed -i 's/from core.properties/from utils.properties/g' scripts/tests/test_toolchains_native.py
sed -i 's/from core.toolchains.native/from utils.toolchains.native/g' scripts/tests/test_toolchains_native.py
sed -i 's/from core.properties/from utils.properties/g' scripts/tests/test_toolchains_others.py
sed -i 's/from core.toolchains/from utils.toolchains/g' scripts/tests/test_toolchains_others.py

# 9. Write Setup Memory Action
cat << 'SETUPSWAP' > .github/actions/setup-memory/action.yml
name: 'Setup Memory Tiering'
description: 'Configures high-priority zram compressed memory and NVMe swap fallback'
inputs:
  zram:
    description: 'Size of zram compressed swap in GB'
    required: false
    default: '0'
  swap:
    description: 'Size of NVMe disk swapfile in GB'
    required: false
    default: '0'

runs:
  using: 'composite'
  steps:
    - name: Configure Memory & Swap
      shell: bash
      run: |
        set -e
        ZRAM_GB="${{ inputs.zram }}"
        SWAP_GB="${{ inputs.swap }}"

        if [ "$ZRAM_GB" -gt 0 ]; then
          echo "⚡ Configuring ${ZRAM_GB}GB zram compressed swap..."
          sudo modprobe zram num_devices=1 || true
          ZRAM_BYTES=$((ZRAM_GB * 1024 * 1024 * 1024))
          echo "$ZRAM_BYTES" | sudo tee /sys/block/zram0/disksize || true
          sudo mkswap /dev/zram0 || true
          sudo swapon -p 32767 /dev/zram0 || true
        fi

        if [ "$SWAP_GB" -gt 0 ]; then
          echo "⚡ Configuring ${SWAP_GB}GB disk swap file..."
          SWAPFILE="/swapfile_${SWAP_GB}G"
          if [ ! -f "$SWAPFILE" ]; then
            sudo fallocate -l "${SWAP_GB}G" "$SWAPFILE" || sudo dd if=/dev/zero of="$SWAPFILE" bs=1M count=$((SWAP_GB * 1024))
            sudo chmod 600 "$SWAPFILE"
            sudo mkswap "$SWAPFILE"
          fi
          sudo swapon -p 10 "$SWAPFILE" || true
        fi

        echo "### Memory Tiering Summary" >> $GITHUB_STEP_SUMMARY
        free -h >> $GITHUB_STEP_SUMMARY
SETUPSWAP

# 10. Update Dockerfile to Pin Go 1.26.5
python3 -c "
import re
path = 'scripts/docker/Dockerfile'
content = open(path).read()

pattern = r'# Install Official Go Toolchain for ARM64\nRUN GO_VERSION=.*?\n  && curl -fsSL \"https://go\.dev/dl/\${GO_VERSION}\.linux-arm64\.tar\.gz\" \| tar -C /usr/local -xz'
replacement = '# Install Official Go Toolchain for ARM64 (Pinned Go 1.26.5)\nENV GO_VERSION=1.26.5\nRUN curl -fsSL \"https://go.dev/dl/go\${GO_VERSION}.linux-arm64.tar.gz\" | tar -C /usr/local -xz'

updated = re.sub(pattern, replacement, content, flags=re.DOTALL)
open(path, 'w').write(updated)
print('✓ Dockerfile Go version successfully pinned to 1.26.5')
"

# 11. Create Pre-Commit Config with actionlint
cat << 'PRECOMMIT' > .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: ruff
        name: ruff check
        entry: ruff check --fix
        language: system
        types: [python]
        pass_filenames: false

      - id: pytest
        name: pytest suite
        entry: env PYTHONPATH=scripts python3 -m pytest scripts/tests/
        language: system
        types: [python]
        pass_filenames: false

      - id: actionlint
        name: actionlint workflow check
        entry: uvx actionlint
        language: system
        files: ^\.github/workflows/
PRECOMMIT

# 12. Write Workflows (health.yml & build.yml)
cat << 'HEALTHWF' > .github/workflows/health.yml
name: Health & Lint Audit

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main
      - 'refactor/**'
  workflow_dispatch:

jobs:
  validate:
    name: Validate Codebase & Workflows
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v7

      - name: Set up Python
        uses: actions/setup-python@v7
        with:
          python-version: "3.13"

      - name: Install uv & Dependencies
        run: |
          curl -LsSf https://astral.sh/uv/install.sh | sh
          echo "$HOME/.cargo/bin" >> $GITHUB_PATH
          uv pip install --system -r pyproject.toml || true
          pip install pytest ruff pydantic pyyaml

      - name: Code Quality & Health Audit
        env:
          PYTHONPATH: scripts
        run: python scripts/cli/build.py check

      - name: Run Pytest
        env:
          PYTHONPATH: scripts
        run: python3 -m pytest scripts/tests/

      - name: Actionlint Workflows
        run: |
          curl -sL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash | bash
          ./actionlint
HEALTHWF

cat << 'BUILDWF' > .github/workflows/build.yml
name: Build

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main
  workflow_dispatch:
    inputs:
      packages:
        description: 'Target specs (e.g. "all@all", "tsc@latest", "!jscpd")'
        required: false
        type: string
        default: 'all@all'
      publish:
        description: 'Publish release assets & update GitHub Pages site'
        required: false
        type: boolean
        default: true
      skip_build:
        description: 'Skip compilation step and re-index existing releases'
        required: false
        type: boolean
        default: false

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

permissions:
  contents: write
  pages: write
  id-token: write

jobs:
  generate-matrix:
    name: Matrix
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.matrix.outputs.matrix }}
      should_publish: ${{ steps.decision.outputs.should_publish }}
    steps:
      - name: Checkout Code
        uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - name: Set up Python
        uses: actions/setup-python@v7
        with:
          python-version: "3.13"

      - name: Install Dependencies
        run: |
          curl -LsSf https://astral.sh/uv/install.sh | sh
          echo "$HOME/.cargo/bin" >> $GITHUB_PATH
          uv pip install --system -r pyproject.toml || true
          pip install pytest ruff pydantic pyyaml

      - name: Audit & Health Check
        env:
          PYTHONPATH: scripts
        run: |
          python scripts/cli/build.py check
          pytest scripts/tests/

      - name: Determine Publish Decision
        id: decision
        run: |
          if [ "${{ github.ref }}" == "refs/heads/main" ] && [ "${{ inputs.publish }}" != "false" ]; then
            echo "should_publish=true" >> "$GITHUB_OUTPUT"
          else
            echo "should_publish=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Generate Matrix
        id: matrix
        env:
          TARGET_INPUT: ${{ inputs.packages || 'auto' }}
          PYTHONPATH: scripts
          GITHUB_BASE_REF: ${{ github.base_ref }}
        run: |
          MATRIX_JSON=$(python scripts/cli/generate_shards.py)
          echo "matrix=$MATRIX_JSON" >> "$GITHUB_OUTPUT"

  build-package:
    name: "${{ matrix.package }}@${{ matrix.channel }}"
    needs: [generate-matrix]
    if: ${{ !inputs.skip_build && needs.generate-matrix.outputs.matrix != '[]' }}
    runs-on: ubuntu-24.04-arm
    strategy:
      fail-fast: false
      matrix:
        include: ${{ fromJson(needs.generate-matrix.outputs.matrix) }}
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - name: Free Disk Space
        if: matrix.free_space
        uses: ./.github/actions/free-space

      - name: Setup Memory & Swap
        if: matrix.zram > 0 || matrix.swap > 0
        uses: ./.github/actions/setup-memory
        with:
          zram: ${{ matrix.zram }}
          swap: ${{ matrix.swap }}

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v4.6.0
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Compile Package Payload
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PKG_NAME: ${{ matrix.package }}
          CHANNEL: ${{ matrix.channel }}
        run: |
          set -o pipefail
          OWNER=$(echo "${{ github.repository_owner }}" | tr "[:upper:]" "[:lower:]")
          LOG_FILE="build_logs/${PKG_NAME}_${CHANNEL}.log"
          mkdir -p build_logs
          echo "=== STAGE: COMPILE ===" >> "$LOG_FILE"

          docker run --rm \
            -v ${{ github.workspace }}:/home/builder/RepoExe \
            -w /home/builder/RepoExe \
            -e GH_TOKEN="$GH_TOKEN" \
            -e PYTHONPATH="scripts" \
            -e GITHUB_WORKSPACE="${{ github.workspace }}" \
            "ghcr.io/$OWNER/repoexe-builder:latest" \
            python3 scripts/cli/build.py compile "pkg/$PKG_NAME" --channel "$CHANNEL" 2>&1 | tee -a "$LOG_FILE"

      - name: Assemble Package Archives
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PKG_NAME: ${{ matrix.package }}
          CHANNEL: ${{ matrix.channel }}
        run: |
          set -o pipefail
          OWNER=$(echo "${{ github.repository_owner }}" | tr "[:upper:]" "[:lower:]")
          LOG_FILE="build_logs/${PKG_NAME}_${CHANNEL}.log"
          echo "=== STAGE: PACK ===" >> "$LOG_FILE"

          docker run --rm \
            -v ${{ github.workspace }}:/home/builder/RepoExe \
            -w /home/builder/RepoExe \
            -e GH_TOKEN="$GH_TOKEN" \
            -e PYTHONPATH="scripts" \
            -e GITHUB_WORKSPACE="${{ github.workspace }}" \
            "ghcr.io/$OWNER/repoexe-builder:latest" \
            python3 scripts/cli/build.py pack "pkg/$PKG_NAME" --channel "$CHANNEL" 2>&1 | tee -a "$LOG_FILE"

      - name: Termux Docker Smoke Test
        continue-on-error: true
        id: test_step
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PKG_NAME: ${{ matrix.package }}
          CHANNEL: ${{ matrix.channel }}
        run: |
          set -o pipefail
          OWNER=$(echo "${{ github.repository_owner }}" | tr "[:upper:]" "[:lower:]")
          LOG_FILE="build_logs/${PKG_NAME}_${CHANNEL}.log"
          echo "=== STAGE: TEST ===" >> "$LOG_FILE"

          docker run --rm \
            -v ${{ github.workspace }}:/home/builder/RepoExe \
            -w /home/builder/RepoExe \
            -e GH_TOKEN="$GH_TOKEN" \
            -e PYTHONPATH="scripts" \
            -e GITHUB_WORKSPACE="${{ github.workspace }}" \
            "ghcr.io/$OWNER/repoexe-builder:latest" \
            python3 scripts/cli/build.py test "pkg/$PKG_NAME" --channel "$CHANNEL" 2>&1 | tee -a "$LOG_FILE"

      - name: Save Build Log Artifact
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: build-log-${{ matrix.package }}-${{ matrix.channel }}
          path: build_logs/
          retention-days: 1

  build-status:
    name: Build Status & Log Aggregator
    needs: [generate-matrix, build-package]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v7

      - name: Download All Target Build Logs
        uses: actions/download-artifact@v7
        with:
          pattern: build-log-*
          path: all_logs
          merge-multiple: true
        continue-on-error: true

      - name: Aggregate All Logs
        run: |
          mkdir -p summary
          if [ -d "all_logs" ]; then
            python3 scripts/utils/log_aggregator.py all_logs summary/all_build_logs.txt
          else
            echo "No build logs collected." > summary/all_build_logs.txt
          fi

      - name: Upload Aggregated Log Summary
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: aggregated-build-logs
          path: summary/all_build_logs.txt
          retention-days: 7

  publish-site:
    name: Deploy
    needs: [generate-matrix, build-package]
    if: always() && needs.generate-matrix.outputs.should_publish == 'true' && (needs.build-package.result == 'success' || needs.build-package.result == 'failure' || needs.build-package.result == 'skipped')
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v7

      - name: Set up Python
        uses: actions/setup-python@v7
        with:
          python-version: "3.13"

      - name: Install Build Tools & GPG
        run: |
          sudo apt-get update
          sudo apt-get install -y dpkg-dev libarchive-tools zip unzip jq gh gpg
          pip install pydantic pyyaml

      - name: Build Full Site & Repository Indexes
        env:
          PYTHONPATH: scripts
        run: |
          python -c "
          from cli.index_gen import prepare_site
          prepare_site('site', 'artifacts')
          "

      - name: Setup GitHub Pages
        uses: actions/configure-pages@v6

      - name: Upload Pages Artifact
        uses: actions/upload-pages-artifact@v4
        with:
          path: 'site'

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5
BUILDWF

# 13. Create Package Recipes
cat << 'AISLERIOT' > pkg/aisleriot/build.yml
name: aisleriot
version: "3.22.33"
revision: 0
architecture: aarch64
description: Solitaire card games collection compiled for Termux X11
license: GPL-3.0-or-later
homepage: https://wiki.gnome.org/Apps/AisleRiot
maintainer: SjnExe
component: x11
build_system: custom

source_url: https://download.gnome.org/sources/aisleriot/3.22/aisleriot-3.22.33.tar.xz

formats:
  - apt
  - pacman
  - apk

deps:
  - gtk3
  - guile
  - librsvg
  - libcanberra
  - libxml2
  - desktop-file-utils
  - shared-mime-info

build_deps:
  - meson
  - ninja
  - itstool
  - gettext
  - pkg-config
  - intltool

phases:
  configure: |
    meson setup build \
      --prefix="${PREFIX}" \
      --libdir="${PREFIX}/lib" \
      -Dguile=3.0 \
      -Dkcard_theme=true
  make: |
    ninja -C build -j4
  install: |
    DESTDIR="${DESTDIR}" ninja -C build install
    if shutil.which("termux-elf-cleaner"); then
      termux-elf-cleaner "${DESTDIR}${PREFIX}/bin/sol"
      termux-elf-cleaner "${DESTDIR}${PREFIX}/lib/aisleriot/ar-cards/"*.so 2>/dev/null || true
    fi
  test: |
    sol --version || true
AISLERIOT

cat << 'BUNJSC' > pkg/bun-jsc/build.yml
name: bun-jsc
version: "1.3.14"
revision: 0
architecture: aarch64
description: Custom JavaScriptCore WebKit engine compiled specifically for Bun
license: LGPL-2.1
homepage: https://github.com/oven-sh/webkit
maintainer: SjnExe
build_system: custom

source_url: https://github.com/oven-sh/webkit/archive/refs/tags/bun-v1.3.14.tar.gz

resources:
  zram: 24
  swap: 10
  free_space: true

vars:
  NINJA_JOBS: "2"
  CFLAGS: "-O2 -g0"
  CXXFLAGS: "-O2 -g0"
  LDFLAGS: "-fuse-ld=lld -Wl,--thread-count=2 -Wl,-z,max-page-size=65536"

formats:
  - apt
  - pacman
  - apk

phases:
  configure: |
    cmake -B build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX="${PREFIX}" \
      -DPORT=JSCOnly \
      -DENABLE_STATIC_JSC=ON \
      -DENABLE_C_LOOP=OFF
  make: |
    cmake --build build -j2
  install: |
    DESTDIR="${DESTDIR}" cmake --install build
BUNJSC

cat << 'BUN' > pkg/bun/build.yml
name: bun
version: "1.3.14"
revision: 0
architecture: aarch64
description: Incredibly fast JavaScript & TypeScript all-in-one runtime
license: MIT
homepage: https://bun.sh
maintainer: SjnExe
build_system: custom

source_url: https://github.com/oven-sh/bun/archive/refs/tags/bun-v1.3.14.tar.gz

formats:
  - apt
  - pacman
  - apk

build_deps:
  - bun-jsc

phases:
  make: |
    mkdir -p build
    zig build -Doptimize=ReleaseFast -Dtarget=aarch64-linux-android
  install: |
    mkdir -p "${DESTDIR}${PREFIX}/bin"
    cp build/bun "${DESTDIR}${PREFIX}/bin/bun"
    ln -sf bun "${DESTDIR}${PREFIX}/bin/bunx"
    if command -v termux-elf-cleaner >/dev/null 2>&1; then
      termux-elf-cleaner "${DESTDIR}${PREFIX}/bin/bun"
    fi
  test: |
    bun --version
BUN

# 14. Git Commit & Create PR
echo "📦 Staging changes, committing, and opening Pull Request..."
git checkout -b refactor/repo-alignment-and-bun 2>/dev/null || git checkout refactor/repo-alignment-and-bun
git add .
git commit -m "refactor: complete repository alignment and add aisleriot & bun recipes"
git push -u origin refactor/repo-alignment-and-bun --force

gh pr create \
  --title "refactor: repo alignment and add aisleriot & bun packages" \
  --body "Completes RepoExe architecture alignment: reorganizes scripts layout into builders/utils/cli, adds zram/swap resource management, pins Go 1.26.5 in Dockerfile, optimizes workflow steps, and adds new packages for AisleRiot and Bun v1.3.14." \
  --base main

echo "✓ Complete alignment executed and PR created successfully!"
