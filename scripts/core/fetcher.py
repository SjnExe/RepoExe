import json
import subprocess
import sys
import urllib.request
from pathlib import Path


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
    output_dir = (Path.cwd() / "output").resolve()

    for dep in build_deps:
        fetched_remote = False
        local_arts = (
            list(Path("artifacts").glob(f"{dep}*.deb"))
            if Path("artifacts").exists()
            else []
        ) + (list(output_dir.glob(f"{dep}*.deb")) if output_dir.exists() else [])
        if local_arts:
            print(
                f"✓ Found local artifact for dependency '{dep}': {local_arts[0].name}"
            )
            subprocess.run(
                ["dpkg-deb", "-x", str(local_arts[0]), str(stage_dir)],
                check=True,
            )
            fetched_remote = True
        else:
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
                    print(
                        f"Fetching pre-built dependency '{dep}' from {download_url}..."
                    )
                    urllib.request.urlretrieve(download_url, dep_deb)
                    subprocess.run(
                        ["dpkg-deb", "-x", str(dep_deb), str(stage_dir)],
                        check=True,
                    )
                    print(
                        f"✓ Extracted pre-built dependency '{dep}' into build staging."
                    )
                    fetched_remote = True
            except Exception as e:
                print(
                    "Notice: Pre-built artifact for dependency"
                    f" '{dep}' could not be fetched ({e})."
                )

        if not fetched_remote:
            print(
                "::error:: Missing required build dependency"
                f" '{dep}' and no pre-built artifact or release exists."
            )
            sys.exit(1)
