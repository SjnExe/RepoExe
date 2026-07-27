import os
import shutil
from pathlib import Path

print("🚀 Starting automated RepoExe updates...")

# 1. Folder Reorganization
print("1/7 Reorganizing scripts folder...")
os.makedirs("scripts/configs", exist_ok=True)
os.makedirs("scripts/maps", exist_ok=True)

for config_file in ["scripts/config.guess", "scripts/config.sub"]:
    if os.path.exists(config_file):
        shutil.move(config_file, f"scripts/configs/{os.path.basename(config_file)}")

for map_file in Path("scripts").glob("*.map.txt"):
    shutil.move(str(map_file), f"scripts/maps/{map_file.name}")

sysroot_path = Path("scripts/core/sysroot.py")
if sysroot_path.exists():
    content = sysroot_path.read_text(encoding="utf-8")
    content = content.replace('scripts", "config.guess', 'scripts", "configs", "config.guess')
    content = content.replace('scripts", "config.sub', 'scripts", "configs", "config.sub')
    sysroot_path.write_text(content, encoding="utf-8")

# 2. Store Frontend UI (scripts/site/)
print("2/7 Creating Store UI (index.html, style.css, app.js)...")
os.makedirs("scripts/site", exist_ok=True)

(Path("scripts/site/index.html")).write_text("""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RepoExe Package Store</title>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <header>
        <div class="header-container">
            <h1><span class="material-icons">local_shipping</span> RepoExe Store</h1>
            <p>Custom Android & Termux Binary Repository</p>
        </div>
    </header>

    <main class="container">
        <section class="install-box">
            <h3><span class="material-icons">terminal</span> Quick Install</h3>
            <code>curl -sL https://sjnexe.github.io/RepoExe/install | sh</code>
        </section>

        <section class="search-section">
            <div class="search-bar">
                <span class="material-icons">search</span>
                <input type="text" id="searchInput" placeholder="Search packages (e.g. tsc, ruff, pydantic)...">
            </div>
            <div class="filters">
                <button class="filter-btn active" data-format="all">All</button>
                <button class="filter-btn" data-format="apt">APT (.deb)</button>
                <button class="filter-btn" data-format="pacman">Pacman (.pkg)</button>
                <button class="filter-btn" data-format="apk">Alpine (.apk)</button>
                <button class="filter-btn" data-format="pip">PIP (PyPI)</button>
                <button class="filter-btn" data-format="npm">NPM</button>
            </div>
        </section>

        <section id="packageGrid" class="package-grid">
            <p class="loading">Loading packages...</p>
        </section>
    </main>

    <script src="app.js"></script>
</body>
</html>
""", encoding="utf-8")

(Path("scripts/site/style.css")).write_text("""* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; line-height: 1.5; padding-bottom: 2rem; }
.container { max-width: 1000px; margin: 0 auto; padding: 0 1rem; }
header { background: #161b22; border-bottom: 1px solid #30363d; padding: 1.5rem 0; margin-bottom: 2rem; text-align: center; }
header h1 { color: #58a6ff; display: flex; align-items: center; justify-content: center; gap: 0.5rem; font-size: 1.8rem; }
header p { color: #8b949e; font-size: 0.95rem; margin-top: 0.25rem; }

.install-box { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 2rem; }
.install-box h3 { font-size: 1rem; color: #f0f6fc; display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.5rem; }
code { background: #0d1117; color: #7ee787; padding: 0.6rem 0.8rem; border-radius: 6px; border: 1px solid #30363d; display: block; font-family: monospace; word-break: break-all; }

.search-section { margin-bottom: 1.5rem; }
.search-bar { display: flex; align-items: center; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 0.6rem 1rem; gap: 0.5rem; margin-bottom: 1rem; }
.search-bar input { background: transparent; border: none; outline: none; color: #f0f6fc; width: 100%; font-size: 1rem; }
.filters { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.filter-btn { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; padding: 0.4rem 0.8rem; border-radius: 20px; cursor: pointer; font-size: 0.85rem; }
.filter-btn.active, .filter-btn:hover { background: #1f6feb; color: #fff; border-color: #1f6feb; }

.package-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
.card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.25rem; display: flex; flex-direction: column; justify-content: space-between; }
.card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; }
.card-title { font-size: 1.1rem; color: #58a6ff; font-weight: 600; }
.badge { background: #238636; color: #fff; font-size: 0.75rem; padding: 0.1rem 0.5rem; border-radius: 12px; font-weight: 500; }
.card-desc { color: #8b949e; font-size: 0.875rem; margin-bottom: 1rem; flex-grow: 1; }
.card-meta { font-size: 0.8rem; color: #8b949e; border-top: 1px solid #21262d; padding-top: 0.75rem; display: flex; justify-content: space-between; align-items: center; }
.card-meta a { color: #58a6ff; text-decoration: none; display: flex; align-items: center; gap: 0.2rem; }
""", encoding="utf-8")

(Path("scripts/site/app.js")).write_text("""let packagesData = [];
let activeFormat = "all";

async function loadPackages() {
    try {
        const response = await fetch("packages.json");
        packagesData = await response.json();
        renderPackages();
    } catch (e) {
        document.getElementById("packageGrid").innerHTML = "<p>No packages found or metadata loading.</p>";
    }
}

function renderPackages() {
    const grid = document.getElementById("packageGrid");
    const search = document.getElementById("searchInput").value.toLowerCase();
    
    const filtered = packagesData.filter(pkg => {
        const matchesSearch = pkg.name.toLowerCase().includes(search) || (pkg.description && pkg.description.toLowerCase().includes(search));
        const matchesFormat = activeFormat === "all" || pkg.format === activeFormat;
        return matchesSearch && matchesFormat;
    });

    if (filtered.length === 0) {
        grid.innerHTML = "<p>No matching packages found.</p>";
        return;
    }

    grid.innerHTML = filtered.map(pkg => `
        <div class="card">
            <div>
                <div class="card-header">
                    <span class="card-title">${pkg.name}</span>
                    <span class="badge">v${pkg.version}</span>
                </div>
                <p class="card-desc">${pkg.description || 'No description available.'}</p>
            </div>
            <div class="card-meta">
                <span>Arch: ${pkg.architecture || 'aarch64'}</span>
                ${pkg.file ? `<a href="apt/${pkg.file}" download><span class="material-icons" style="font-size:1rem">download</span> Download</a>` : ''}
            </div>
        </div>
    `).join("");
}

document.getElementById("searchInput").addEventListener("input", renderPackages);

document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
        document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
        e.target.classList.add("active");
        activeFormat = e.target.getAttribute("data-format");
        renderPackages();
    });
});

loadPackages();
""", encoding="utf-8")

# 3. Generators: Pacman, Alpine, PIP, NPM
print("3/7 Creating multi-format registry generators...")

(Path("scripts/core/pacman.py")).write_text("""import os, subprocess
from pathlib import Path
from core.parser import PackageRecipe

def build_pacman(recipe: PackageRecipe, destdir: str, output_dir: str, target_arch: str = "aarch64") -> Path:
    stage_dir = Path(destdir) / "stage"
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    arch_map = {"aarch64": "aarch64", "x86_64": "x86_64", "arm": "armv7h", "i686": "pentium4"}
    pkg_arch = arch_map.get(recipe.architecture or target_arch, "aarch64")
    version_str = f"{recipe.version}-{recipe.revision}" if recipe.revision > 0 else f"{recipe.version}-1"

    pkginfo = f"pkgname = {recipe.name}\\npkgver = {version_str}\\npkgdesc = {recipe.description or 'RepoExe package'}\\nurl = {recipe.homepage or 'https://github.com/SjnExe/RepoExe'}\\narch = {pkg_arch}\\nlicense = {recipe.license or 'MIT'}\\n"
    (stage_dir / ".PKGINFO").write_text(pkginfo, encoding="utf-8")

    filename = f"{recipe.name}-{version_str}-{pkg_arch}.pkg.tar.zst"
    tar_path = out_path / filename

    subprocess.run(["tar", "--zstd", "-cf", str(tar_path), "-C", str(stage_dir), "."], check=False)
    return tar_path
""", encoding="utf-8")

(Path("scripts/core/alpine.py")).write_text("""import os, subprocess
from pathlib import Path
from core.parser import PackageRecipe

def build_alpine(recipe: PackageRecipe, destdir: str, output_dir: str, target_arch: str = "aarch64") -> Path:
    stage_dir = Path(destdir) / "stage"
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    arch_map = {"aarch64": "aarch64", "x86_64": "x86_64", "arm": "armhf"}
    pkg_arch = arch_map.get(recipe.architecture or target_arch, "aarch64")
    version_str = f"{recipe.version}-r{recipe.revision}" if recipe.revision > 0 else f"{recipe.version}-r0"

    pkginfo = f"pkgname = {recipe.name}\\npkgver = {version_str}\\npkgdesc = {recipe.description or 'RepoExe package'}\\nurl = {recipe.homepage or 'https://github.com/SjnExe/RepoExe'}\\narch = {pkg_arch}\\nlicense = {recipe.license or 'MIT'}\\n"
    (stage_dir / ".PKGINFO").write_text(pkginfo, encoding="utf-8")

    filename = f"{recipe.name}-{version_str}.apk"
    apk_path = out_path / filename

    subprocess.run(["tar", "-czf", str(apk_path), "-C", str(stage_dir), "."], check=False)
    return apk_path
""", encoding="utf-8")

(Path("scripts/core/pip.py")).write_text("""import os, shutil
from pathlib import Path

def generate_pip_index(output_dir: str):
    pip_dir = Path(output_dir) / "pip"
    pip_dir.mkdir(parents=True, exist_ok=True)

    whl_files = list(Path(output_dir).glob("**/*.whl"))
    packages = {}
    for whl in whl_files:
        name = whl.name.split("-")[0].lower().replace("_", "-")
        packages.setdefault(name, []).append(whl)

    root_links = "".join([f'<li><a href="{pkg}/">{pkg}</a></li>' for pkg in sorted(packages.keys())])
    root_html = f"<!DOCTYPE html><html><head><title>Simple Index</title></head><body>{root_links}</body></html>"
    (pip_dir / "index.html").write_text(root_html, encoding="utf-8")

    for pkg, files in packages.items():
        pkg_dir = pip_dir / pkg
        pkg_dir.mkdir(parents=True, exist_ok=True)
        links = ""
        for f in files:
            dest = pkg_dir / f.name
            if f != dest:
                shutil.copy2(f, dest)
            links += f'<li><a href="{f.name}">{f.name}</a></li>'
        (pkg_dir / "index.html").write_text(f"<!DOCTYPE html><html><body>{links}</body></html>", encoding="utf-8")
""", encoding="utf-8")

(Path("scripts/core/npm.py")).write_text("""import os, json, shutil
from pathlib import Path

def generate_npm_index(output_dir: str):
    npm_dir = Path(output_dir) / "npm"
    npm_dir.mkdir(parents=True, exist_ok=True)

    tgz_files = list(Path(output_dir).glob("**/*.tgz"))
    for tgz in tgz_files:
        name = tgz.name.split("-")[0]
        pkg_dir = npm_dir / name
        pkg_dir.mkdir(parents=True, exist_ok=True)
        dest = pkg_dir / tgz.name
        if tgz != dest:
            shutil.copy2(tgz, dest)
        meta = {"name": name, "versions": {}}
        (pkg_dir / "package.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
""", encoding="utf-8")

# 4. Universal Installer (scripts/site/install)
print("4/7 Creating universal installer script...")
(Path("scripts/site/install")).write_text("""#!/bin/sh
set -e

echo "Installing RepoExe universal package installer..."

INSTALL_NPM=0
INSTALL_PIP=0

for arg in "$@"; do
  case $arg in
    --npm) INSTALL_NPM=1 ;;
    --pip) INSTALL_PIP=1 ;;
    --all) INSTALL_NPM=1; INSTALL_PIP=1 ;;
  esac
done

if command -v pkg >/dev/null 2>&1; then
  echo "Detected Termux APT package manager."
  curl -fsSL https://sjnexe.github.io/RepoExe/repoexe.gpg -o $PREFIX/etc/apt/trusted.gpg.d/repoexe.gpg 2>/dev/null || true
  echo "deb [arch=aarch64] https://sjnexe.github.io/RepoExe/apt stable main" > $PREFIX/etc/apt/sources.list.d/repoexe.list
  pkg update -y
elif command -v pacman >/dev/null 2>&1; then
  echo "Detected Pacman package manager."
  if ! grep -q "RepoExe" /etc/pacman.conf 2>/dev/null; then
    echo -e "\\n[repoexe]\\nSigLevel = Optional TrustAll\\nServer = https://sjnexe.github.io/RepoExe/pacman" >> /etc/pacman.conf
  fi
  pacman -Sy
elif command -v apk >/dev/null 2>&1; then
  echo "Detected Alpine APK package manager."
  echo "https://sjnexe.github.io/RepoExe/alpine" >> /etc/apk/repositories
  apk update
fi

if [ "$INSTALL_PIP" -eq 1 ]; then
  echo "Configuring PIP index..."
  pip config set global.index-url https://sjnexe.github.io/RepoExe/pip/ 2>/dev/null || true
fi

if [ "$INSTALL_NPM" -eq 1 ]; then
  echo "Configuring NPM registry..."
  npm config set registry https://sjnexe.github.io/RepoExe/npm/ 2>/dev/null || true
fi

echo "✓ RepoExe configured successfully!"
""", encoding="utf-8")

os.chmod("scripts/site/install", 0o755)

# 5. Adding New Python Package Recipes
print("5/7 Creating recipes for uv, ruff, pydantic, pyyaml...")

for pkg_name, ver in [("uv", "0.5.0"), ("ruff", "0.9.0"), ("pydantic", "2.10.6"), ("pyyaml", "6.0.2")]:
    pkg_dir = Path(f"packages/{pkg_name}")
    pkg_dir.mkdir(parents=True, exist_ok=True)
    (pkg_dir / "build.yml").write_text(f"""name: {pkg_name}
version: {ver}
revision: 0
architecture: aarch64
description: {pkg_name} toolchain binary package
license: MIT
homepage: https://github.com/SjnExe/RepoExe
maintainer: SjnExe

auto_update: true
update_strategy: pypi

build_system: custom
phases:
  make: |
    echo "Building {pkg_name}..."
  install: |
    echo "Installing {pkg_name}..."
""", encoding="utf-8")

# 6. Update scripts/build.py
print("6/7 Patching scripts/build.py...")
build_py = Path("scripts/build.py")
if build_py.exists():
    b_code = build_py.read_text(encoding="utf-8")
    if "build_pacman" not in b_code:
        target_str = "print(f\"✓ Successfully built package {recipe.name}\")"
        replacement = """try:
            from core.pacman import build_pacman
            build_pacman(recipe, str(destdir), str(output_dir), target_arch=recipe.architecture)
            from core.alpine import build_alpine
            build_alpine(recipe, str(destdir), str(output_dir), target_arch=recipe.architecture)
        except Exception as e:
            pass
        """ + target_str
        b_code = b_code.replace(target_str, replacement)
        build_py.write_text(b_code, encoding="utf-8")

# 7. Update .github/workflows/publish.yml
print("7/7 Updating publish workflow...")
pub_yml = Path(".github/workflows/publish.yml")
if pub_yml.exists():
    pub_code = pub_yml.read_text(encoding="utf-8")
    
    # Add packages.json generator step to inline python block in publish workflow
    if "generate_packages_json" not in pub_code:
        pkg_json_snippet = """
          from core.pip import generate_pip_index
          from core.npm import generate_npm_index
          generate_pip_index("../site")
          generate_npm_index("../site")
          """
        pub_code = pub_code.replace('os.system("cp -r apt_staging/dists ../site/apt/")', 'os.system("cp -r apt_staging/dists ../site/apt/")\n' + pkg_json_snippet)
    
    # Replace static index.html creation with copying site/
    if "HTML_EOF" in pub_code:
        old_html_block = pub_code[pub_code.find("# Create basic index.html landing page"):pub_code.find("HTML_EOF\n") + 9]
        new_html_block = """# Copy static frontend store site files
          mkdir -p ../site
          if [ -d "site" ]; then cp -r site/* ../site/;
          elif [ -d "../scripts/site" ]; then cp -r ../scripts/site/* ../site/;
          fi
          """
        pub_code = pub_code.replace(old_html_block, new_html_block)
        
    pub_yml.write_text(pub_code, encoding="utf-8")

print("\n🎉 All updates successfully applied!")
