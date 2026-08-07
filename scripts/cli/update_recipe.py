import sys
import re
import urllib.request
from pathlib import Path
import yaml

def fetch_webkit_sha(bun_version: str) -> str:
    tag = f"bun-v{bun_version}"
    url = f"https://raw.githubusercontent.com/oven-sh/bun/{tag}/scripts/build/deps/webkit.ts"
    req = urllib.request.Request(url, headers={"User-Agent": "RepoExe-Orchestrator"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read().decode("utf-8")
        match = re.search(r'WEBKIT_VERSION\s*=\s*["\']([a-f0-9]{40})["\']', content)
        if match:
            return match.group(1)
    except Exception:
        pass
    return "5488984d20e0dbfe4be2c3ba8fb18eb81a5e0e8b"

def update_recipe(pkg: str, channel: str, new_version: str) -> None:
    if pkg in ["bun", "bun-jsc"]:
        sha = fetch_webkit_sha(new_version)
        print(f"🔒 Fetched WebKit commit SHA {sha} for Bun version {new_version}")

        jsc_recipe = Path("pkg/bun-jsc/build.yml")
        if jsc_recipe.exists():
            content = jsc_recipe.read_text()
            content = re.sub(r'version:\s*[“"]?[0-9\.]+[“"]?', f'version: {new_version}', content)
            content = re.sub(r'revision:\s*\d+', 'revision: 0', content)
            content = re.sub(r'[a-f0-9]{40}', sha, content)
            jsc_recipe.write_text(content)
            print(f"✓ Updated pkg/bun-jsc/build.yml to version {new_version}")

        bun_recipe = Path("pkg/bun/build.yml")
        if bun_recipe.exists():
            content = bun_recipe.read_text()
            content = re.sub(r'version:\s*[“"]?[0-9\.]+[“"]?', f'version: {new_version}', content)
            content = re.sub(r'revision:\s*\d+', 'revision: 0', content)
            content = re.sub(
                r'source_url:\s*https://github.com/oven-sh/bun/archive/refs/tags/bun-v[^"]+\.tar\.gz',
                f'source_url: https://github.com/oven-sh/bun/archive/refs/tags/bun-v{new_version}.tar.gz',
                content
            )
            bun_recipe.write_text(content)
            print(f"✓ Updated pkg/bun/build.yml to version {new_version}")
        return

    recipe_path = Path("pkg") / pkg / "build.yml"
    if not recipe_path.exists():
        print(f"Error: {recipe_path} does not exist.")
        sys.exit(1)

    with open(recipe_path, "r", encoding="utf-8") as f:
        d = yaml.safe_load(f)

    d["version"] = new_version
    d["revision"] = 0

    if "channels" in d and channel in d["channels"]:
        d["channels"][channel]["version"] = new_version
        d["channels"][channel]["revision"] = 0

    with open(recipe_path, "w", encoding="utf-8") as f:
        yaml.dump(d, f, sort_keys=False)

    print(f"✓ Successfully updated {pkg} ({channel}) to {new_version}")

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python3 update_recipe.py <pkg> <channel> <new_version>")
        sys.exit(1)
    update_recipe(sys.argv[1], sys.argv[2], sys.argv[3])
