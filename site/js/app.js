let allPackages = [];

// Parse APT Packages file format into JS objects
function parsePackages(text) {
    const pkgs = text.split('\n\n').filter(p => p.trim() !== '');
    return pkgs.map(pkg => {
        const obj = {};
        const lines = pkg.split('\n');
        let currentKey = '';
        lines.forEach(line => {
            if (line.startsWith(' ')) {
                obj[currentKey] += '\n' + line.trim();
            } else {
                const match = line.match(/^([\w-]+):\s*(.*)$/);
                if (match) {
                    currentKey = match[1];
                    obj[currentKey] = match[2];
                }
            }
        });
        return obj;
    });
}

// Fetch metadata on load
async function loadPackages() {
    try {
        // Attempt to load live metadata, fallback to mock if failed (for local dev)
        const response = await fetch('dists/stable/main/binary-aarch64/Packages');
        if (response.ok) {
            const text = await response.text();
            allPackages = parsePackages(text);
        } else {
            loadMockData();
        }
    } catch (e) {
        loadMockData();
    }

    const urlParams = new URLSearchParams(window.location.search);
    const targetPkg = urlParams.get('pkg');

    if (targetPkg) {
        const filtered = allPackages.filter(p => p.Package === targetPkg);
        renderPackages(filtered.length > 0 ? filtered : allPackages);
    } else {
        renderPackages(allPackages);
    }
}

function loadMockData() {
    allPackages = [
        { Package: "example-pkg", Version: "1.0.0", Architecture: "aarch64", Description: "An example package", Size: "10240", Depends: "python" },
        { Package: "python", Version: "3.11.4", Architecture: "aarch64", Description: "Python programming language", Size: "5000000", Depends: "libffi, openssl" }
    ];
}

function renderPackages(packages) {
    const container = document.getElementById('package-container');
    container.innerHTML = '';

    if (packages.length === 0) {
        container.innerHTML = '<p style="text-align:center; color: var(--text-secondary);">No packages found.</p>';
        return;
    }

    packages.forEach(pkg => {
        const sizeKB = pkg.Size ? (parseInt(pkg.Size) / 1024).toFixed(1) + ' KB' : 'Unknown size';

        const card = document.createElement('div');
        card.className = 'package-card';
        card.innerHTML = `
            <h2>${pkg.Package} <span>v${pkg.Version}</span></h2>
            <p>${pkg.Description}</p>
            <div class="pkg-meta">Arch: ${pkg.Architecture} | Size: ${sizeKB}</div>

            <div class="pkg-install">
                <code>pkg i ${pkg.Package}</code>
                <button onclick="copyToClipboard('pkg i ${pkg.Package}')" title="Copy install command">
                    <span class="material-symbols-outlined" style="font-size: 1.2rem;">content_copy</span>
                </button>
            </div>
            ${pkg.Depends ? `<button class="dep-btn" onclick="showDependencies('${pkg.Package}')">View Dependencies</button>` : ''}
        `;
        container.appendChild(card);
    });
}

function filterPackages() {
    const search = document.getElementById('search').value.toLowerCase();
    const filtered = allPackages.filter(pkg =>
        (pkg.Package && pkg.Package.toLowerCase().includes(search)) ||
        (pkg.Description && pkg.Description.toLowerCase().includes(search))
    );
    renderPackages(filtered);
}

function toggleView() {
    const container = document.getElementById('package-container');
    const icon = document.getElementById('view-icon');
    if (container.classList.contains('grid-view')) {
        container.classList.replace('grid-view', 'list-view');
        icon.textContent = 'view_list';
    } else {
        container.classList.replace('list-view', 'grid-view');
        icon.textContent = 'grid_view';
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
}

function copyRepoInstall() {
    copyToClipboard('curl -sL https://SjnExe.github.io/RepoExe/install | bash');
}

// Dependency Visualizer Logic
function getDependencies(pkgName) {
    const pkg = allPackages.find(p => p.Package === pkgName);
    if (!pkg || !pkg.Depends) return [];
    // Split by comma and remove version constraints e.g. "python (>= 3.9)"
    return pkg.Depends.split(',').map(d => d.split('(')[0].trim());
}

function buildDepTreeHTML(pkgName, visited = new Set()) {
    if (visited.has(pkgName)) return `<li>${pkgName} <i>(circular/repeated)</i></li>`;
    visited.add(pkgName);

    const deps = getDependencies(pkgName);
    if (deps.length === 0) return `<li><b>${pkgName}</b></li>`;

    let html = `<li><b>${pkgName}</b><ul>`;
    deps.forEach(d => {
        html += buildDepTreeHTML(d, new Set(visited));
    });
    html += `</ul></li>`;
    return html;
}

function showDependencies(pkgName) {
    const treeDiv = document.getElementById('dep-tree');
    treeDiv.innerHTML = `<ul>${buildDepTreeHTML(pkgName)}</ul>`;
    document.getElementById('dep-modal').style.display = 'block';
}

function closeModal() {
    document.getElementById('dep-modal').style.display = 'none';
}

window.onclick = function(event) {
    const modal = document.getElementById('dep-modal');
    if (event.target == modal) {
        modal.style.display = "none";
    }
}

window.onload = loadPackages;
