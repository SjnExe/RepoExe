import json
import shutil
import subprocess
import urllib.request
from pathlib import Path

from builders.debian import generate_apt_metadata, generate_release_file
from cli.prune import get_expected_asset_filenames
from utils.metadata import generate_packages_json
from utils.parser import parse_recipe


def get_exact_package_artifacts(art_path: Path, pkg_name: str) -> list[Path]:
    """Finds exact artifact files belonging strictly to pkg_name to prevent cross-package asset leakage."""
    matching = []

    for f in art_path.rglob("*"):
        if not f.is_file():
            continue
        name = f.name

        if (
            name.startswith(f"{pkg_name}_")
            and name.endswith(".deb")
            or name.startswith(f"{pkg_name}-")
            and (".pkg.tar.zst" in name or ".pkg.tar.gz" in name)
            or name.startswith(f"{pkg_name}-")
            and name.endswith(".apk")
        ):
            matching.append(f)

    return sorted(set(matching))


def fetch_existing_release_assets_to_artifacts(art_path: Path) -> None:
    """Fetches existing release assets from GitHub Releases if gh CLI is available to prevent wiping unbuilt packages in matrix runs."""
    if not shutil.which("gh"):
        return

    art_path.mkdir(parents=True, exist_ok=True)
    pkgs_dir = Path(__file__).resolve().parents[2] / "pkg"

    repo_res = subprocess.run(
        ["gh", "repo", "view", "--json", "name,owner"],
        capture_output=True,
        text=True,
        check=False,
    )
    if repo_res.returncode != 0:
        return

    try:
        repo_info = json.loads(repo_res.stdout)
        owner = repo_info["owner"]["login"]
        repo_name = repo_info["name"]
    except (json.JSONDecodeError, KeyError) as e:
        print(f"Notice: Failed to parse repo info in index_gen: {e}")
        return

    releases_res = subprocess.run(
        ["gh", "api", f"repos/{owner}/{repo_name}/releases?per_page=100"],
        capture_output=True,
        text=True,
        check=False,
    )
    if releases_res.returncode != 0:
        return

    try:
        releases = json.loads(releases_res.stdout)
    except json.JSONDecodeError as e:
        print(f"Notice: Failed to parse releases in index_gen: {e}")
        return

    for release in releases:
        tag = release.get("tag_name", "")
        if "@" not in tag:
            continue

        pkg, channel = tag.split("@", 1)
        recipe_path = pkgs_dir / pkg / "pkg.yml"
        expected_files: set[str] = set()

        if recipe_path.exists():
            try:
                recipe = parse_recipe(recipe_path, channel=channel)
                expected_files = get_expected_asset_filenames(recipe)
            except (ValueError, KeyError, RuntimeError, OSError) as e:
                print(f"Notice: Could not parse recipe for {tag}: {e}")

        for asset in release.get("assets", []):
            name = asset.get("name", "")
            download_url = asset.get("browser_download_url")
            if not name or not download_url:
                continue

            if expected_files and name not in expected_files:
                print(f"Skipping outdated published asset for index accumulation: {name} (not in expected files for {tag})")
                continue

            target_file = art_path / name
            if not target_file.exists():
                print(f"⚡ Downloading existing published asset for index accumulation: {name}...")
                with urllib.request.urlopen(download_url) as resp, open(target_file, "wb") as out_f:
                    shutil.copyfileobj(resp, out_f)


def prepare_site(
    site_dir: str | Path = "site", artifacts_dir: str | Path = "artifacts"
) -> None:
    """Builds full multi-format repository index from release artifacts supporting both arm64 and aarch64."""
    s_path = Path(site_dir)
    art_path = Path(artifacts_dir)

    for sub in ["apt", "pacman", "alpine"]:
        (s_path / sub).mkdir(parents=True, exist_ok=True)

    apt_staging = Path("apt_staging")
    apt_staging.mkdir(parents=True, exist_ok=True)

    # 1. First upload newly built artifacts to GitHub Releases
    if art_path.exists() and shutil.which("gh"):
        print("⚡ Publishing release artifacts to GitHub Releases...")
        for pkg_meta_file in art_path.rglob("*_metadata.json"):
            try:
                meta = json.loads(pkg_meta_file.read_text(encoding="utf-8"))
                pkg_name = meta.get("name")
                channel = meta.get("channel", "latest")
                tag = f"{pkg_name}@{channel}"

                matching_files = get_exact_package_artifacts(art_path, pkg_name)
                if not matching_files:
                    print(f"Notice: No artifact files matched for tag {tag}")
                    continue

                upload_args = [str(f) for f in matching_files]
                notes_body = json.dumps(meta, indent=2)

                subprocess.run(
                    ["gh", "release", "view", tag], capture_output=True, check=False
                )
                res = subprocess.run(
                    ["gh", "release", "create", tag]
                    + upload_args
                    + [
                        "--title",
                        tag,
                        "--notes",
                        notes_body,
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if res.returncode == 0:
                    print(f"✓ Successfully published GitHub release tag: {tag}")
                else:
                    res_up = subprocess.run(
                        ["gh", "release", "upload", tag] + upload_args + ["--clobber"],
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    subprocess.run(
                        ["gh", "release", "edit", tag, "--notes", notes_body],
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    if res_up.returncode == 0:
                        print(f"✓ Uploaded release assets to existing tag: {tag}")
                    else:
                        print(
                            f"::warning:: Failed to upload release assets for {tag}: {res_up.stderr.strip()}"
                        )
            except (json.JSONDecodeError, KeyError, ValueError, RuntimeError, OSError) as e:
                print(
                    f"::warning:: Failed publishing release tag for {pkg_meta_file.name}: {e}"
                )

    # 2. Fetch existing release assets to ensure matrix/partial builds do not erase existing packages from repository site index
    fetch_existing_release_assets_to_artifacts(art_path)

    # 3. Copy accumulated artifacts to respective format directories
    if art_path.exists():
        for f in art_path.rglob("*"):
            if not f.is_file():
                continue
            if f.name.endswith(".deb"):
                shutil.copy2(f, apt_staging / f.name)
                shutil.copy2(f, s_path / "apt" / f.name)
            elif f.name.endswith(".pkg.tar.zst") or f.name.endswith(".pkg.tar.gz"):
                shutil.copy2(f, s_path / "pacman" / f.name)
            elif f.name.endswith(".apk"):
                shutil.copy2(f, s_path / "alpine" / f.name)

    # 4. Generate APT Metadata and Release File
    deb_files = list(apt_staging.glob("*.deb"))
    arches = set()
    for f in deb_files:
        arch = f.name.split("_")[-1].replace(".deb", "")
        if arch != "all":
            arches.add(arch)
            if arch == "arm64":
                arches.add("aarch64")
            elif arch == "aarch64":
                arches.add("arm64")

    if not arches:
        arches.update(["arm64", "aarch64"])

    for arch in arches:
        generate_apt_metadata(str(apt_staging), component="main", arch=arch)

    generate_release_file(str(apt_staging), suite="stable", component="main")

    if (apt_staging / "dists").exists():
        shutil.copytree(
            apt_staging / "dists", s_path / "apt" / "dists", dirs_exist_ok=True
        )

    # 5. Generate packages.json Store Manifest
    generate_packages_json(
        Path(__file__).resolve().parents[2] / "pkg",
        s_path / "packages.json",
        artifacts_dir=art_path,
    )

    # 6. Copy Frontend Source & Security Keyrings to site/ root
    root_dir = Path(__file__).resolve().parents[2]

    # Copy frontend static files
    site_src_dir = root_dir / "scripts" / "site"
    if site_src_dir.exists():
        shutil.copytree(site_src_dir, s_path, dirs_exist_ok=True)

    for key in ["scripts/repoexe.gpg", "scripts/repoexe.rsa.pub"]:
        src = root_dir / key
        if src.exists():
            shutil.copy2(src, s_path / src.name)

    (s_path / ".nojekyll").touch()
    print(f"✓ Complete RepoExe site environment successfully generated at {s_path}")


if __name__ == "__main__":
    prepare_site()
