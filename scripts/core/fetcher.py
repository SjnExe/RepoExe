import contextlib
import gzip
import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

TERMUX_REPOS = [
    (
        "https://packages-cf.termux.dev/apt/termux-main",
        "dists/stable/main/binary-aarch64/Packages",
    ),
    (
        "https://packages-cf.termux.dev/apt/termux-x11",
        "dists/x11/main/binary-aarch64/Packages",
    ),
    (
        "https://packages-cf.termux.dev/apt/termux-root",
        "dists/root/stable/binary-aarch64/Packages",
    ),
]

USER_AGENT = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

_PKG_INDEX: dict[str, dict] = {}


def _download_file(url: str, dest_path: Path) -> None:
    """Streams remote files to disk with standard User-Agent headers to bypass CDN bot protection."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with (
        urllib.request.urlopen(req, timeout=30) as resp,
        open(dest_path, "wb") as out_f,
    ):
        shutil.copyfileobj(resp, out_f)


def check_existing_release_hash(pkg_name: str, channel: str, target_hash: str) -> bool:
    tag = f"{pkg_name}@{channel}"
    api_url = f"https://api.github.com/repos/SjnExe/RepoExe/releases/tags/{tag}"
    try:
        req = urllib.request.Request(api_url, headers={"User-Agent": USER_AGENT})
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


def _load_termux_index() -> dict[str, dict]:
    global _PKG_INDEX
    if _PKG_INDEX:
        return _PKG_INDEX

    cache_file = Path("/tmp/termux_apt_index.json")
    if cache_file.exists():
        with contextlib.suppress(Exception):
            _PKG_INDEX = json.loads(cache_file.read_text(encoding="utf-8"))
            if _PKG_INDEX:
                return _PKG_INDEX

    index = {}
    for base_url, rel_path in TERMUX_REPOS:
        for ext in (".gz", ""):
            url = f"{base_url}/{rel_path}{ext}"
            with contextlib.suppress(Exception):
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    raw = resp.read()
                    text = (
                        gzip.decompress(raw).decode("utf-8", errors="replace")
                        if ext == ".gz"
                        else raw.decode("utf-8", errors="replace")
                    )

                    current_pkg: dict[str, str] = {}
                    for line in text.splitlines():
                        line = line.rstrip()
                        if not line:
                            if "Package" in current_pkg and "Filename" in current_pkg:
                                pkg_name = current_pkg["Package"]
                                current_pkg["BaseUrl"] = base_url
                                index[pkg_name] = current_pkg
                                if "Provides" in current_pkg:
                                    for prov in current_pkg["Provides"].split(","):
                                        p_name = prov.strip().split()[0]
                                        if p_name and p_name not in index:
                                            index[p_name] = current_pkg
                            current_pkg = {}
                        elif ":" in line and not line.startswith(" "):
                            k, v = line.split(":", 1)
                            current_pkg[k.strip()] = v.strip()
                    if "Package" in current_pkg and "Filename" in current_pkg:
                        pkg_name = current_pkg["Package"]
                        current_pkg["BaseUrl"] = base_url
                        index[pkg_name] = current_pkg
                    break

    _PKG_INDEX = index
    with contextlib.suppress(Exception):
        cache_file.write_text(json.dumps(index), encoding="utf-8")
    return _PKG_INDEX


def _fetch_single_dep(dep: str, destdir: Path, fetched: set[str]) -> bool:
    if dep in fetched:
        return True

    stage_dir = destdir / "stage"
    prefix_root = Path("/data/data/com.termux/files/usr")
    prefix_root.mkdir(parents=True, exist_ok=True)
    output_dir = (Path.cwd() / "output").resolve()

    # 1. Local artifacts
    local_arts = (
        list(Path("artifacts").glob(f"{dep}*.deb"))
        if Path("artifacts").exists()
        else []
    ) + (list(output_dir.glob(f"{dep}*.deb")) if output_dir.exists() else [])
    if local_arts:
        print(f"✓ Found local artifact for dependency '{dep}': {local_arts[0].name}")
        subprocess.run(
            ["dpkg-deb", "-x", str(local_arts[0]), str(stage_dir)], check=True
        )
        subprocess.run(
            [
                "dpkg-deb",
                "-x",
                str(local_arts[0]),
                str(prefix_root.parent.parent.parent.parent),
            ],
            check=False,
        )
        fetched.add(dep)
        return True

    # 2. RepoExe releases
    tag = f"{dep}@latest"
    api_url = f"https://api.github.com/repos/SjnExe/RepoExe/releases/tags/{tag}"
    try:
        req = urllib.request.Request(api_url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=5) as resp:
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
            _download_file(download_url, dep_deb)
            subprocess.run(["dpkg-deb", "-x", str(dep_deb), str(stage_dir)], check=True)
            subprocess.run(
                [
                    "dpkg-deb",
                    "-x",
                    str(dep_deb),
                    str(prefix_root.parent.parent.parent.parent),
                ],
                check=False,
            )
            fetched.add(dep)
            return True
    except Exception:
        pass

    # 3. Official Termux Upstream Mirrors
    index = _load_termux_index()
    pkg_info = (
        index.get(dep) or index.get(f"lib{dep}") or index.get(dep.removeprefix("lib"))
    )
    if pkg_info:
        base_url = pkg_info["BaseUrl"]
        deb_filename = Path(pkg_info["Filename"]).name
        deb_url = f"{base_url}/{pkg_info['Filename']}"
        deb_dest = destdir / deb_filename
        print(f"⚡ Fetching Termux upstream dependency '{dep}' from {deb_url}...")
        _download_file(deb_url, deb_dest)

        extract_tmp = Path("/tmp/deb_extract")
        shutil.rmtree(extract_tmp, ignore_errors=True)
        extract_tmp.mkdir(parents=True, exist_ok=True)
        subprocess.run(["dpkg-deb", "-x", str(deb_dest), str(extract_tmp)], check=True)

        extracted_usr = extract_tmp / "data" / "data" / "com.termux" / "files" / "usr"
        if extracted_usr.exists():
            shutil.copytree(extracted_usr, prefix_root, dirs_exist_ok=True)
            shutil.copytree(
                extracted_usr,
                stage_dir / "data" / "data" / "com.termux" / "files" / "usr",
                dirs_exist_ok=True,
            )
        else:
            for item in extract_tmp.iterdir():
                if item.name != "DEBIAN":
                    if item.is_dir():
                        shutil.copytree(item, prefix_root, dirs_exist_ok=True)
                    else:
                        shutil.copy2(item, prefix_root)
        shutil.rmtree(extract_tmp, ignore_errors=True)

        fetched.add(dep)
        fetched.add(pkg_info.get("Package", dep))

        # Recursively resolve dependencies
        depends_str = pkg_info.get("Depends", "")
        if depends_str:
            for req in depends_str.split(","):
                req_name = req.strip().split()[0].split(":")[0]
                if (
                    req_name
                    and req_name
                    not in (
                        "dpkg",
                        "apt",
                        "bash",
                        "termux-tools",
                        "command-not-found",
                    )
                    and req_name not in fetched
                ):
                    _fetch_single_dep(req_name, destdir, fetched)
        return True

    return False


def resolve_and_fetch_build_dependencies(build_deps: list[str], destdir: Path) -> None:
    if not build_deps:
        return

    print(f"Resolving build dependencies: {', '.join(build_deps)}")
    fetched: set[str] = set()

    for dep in build_deps:
        success = _fetch_single_dep(dep, destdir, fetched)
        if not success:
            print(
                f"::error:: Missing required build dependency '{dep}' and no artifact exists."
            )
            sys.exit(1)
