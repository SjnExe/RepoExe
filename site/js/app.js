let allPackages = [];
let displayedCount = 0;
const LOAD_CHUNK = 20;
let currentRenderList = [];

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
    const arches = ['aarch64', 'arm', 'i686', 'x86_64'];
    let packagesMap = new Map();

    try {
        for (const arch of arches) {
            const response = await fetch(`dists/stable/main/binary-${arch}/Packages`);
            if (response.ok) {
                const text = await response.text();
                const pkgs = parsePackages(text);

                pkgs.forEach(pkg => {
                    if (!pkg.Package) return;
                    if (packagesMap.has(pkg.Package)) {
                        let existing = packagesMap.get(pkg.Package);
                        if (!existing.architectures.includes(arch)) {
                            existing.architectures.push(arch);
                        }
                    } else {
                        // Initialize custom architectures array, defaults to the parsed one
                        pkg.architectures = [arch];
                        packagesMap.set(pkg.Package, pkg);
                    }
                });
            }
        }

        if (packagesMap.size > 0) {
            allPackages = Array.from(packagesMap.values());

            // Post-process to consolidate into "all" if present in all 4 architectures
            allPackages.forEach(pkg => {
                if (pkg.architectures.length === 4) {
                    pkg.architectures = ['all'];
                }
            });
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
        { Package: "example-pkg", Version: "1.0.0", architectures: ["all"], Description: "An example package", Size: "10240", Depends: "python" },
        { Package: "python", Version: "3.11.4", architectures: ["aarch64", "arm"], Description: "Python programming language", Size: "5000000", Depends: "libffi, openssl" }
    ];
}

function renderPackages(packages, append = false) {
    const container = document.getElementById('package-container');

    if (!append) {
        container.innerHTML = '';
        currentRenderList = packages;
        displayedCount = 0;
    }

    if (currentRenderList.length === 0) {
        container.innerHTML = '<p style="text-align:center; color: var(--text-secondary);">No packages found.</p>';
        return;
    }

    const toRender = currentRenderList.slice(displayedCount, displayedCount + LOAD_CHUNK);

    toRender.forEach(pkg => {
        // Generate arch tags HTML
        let archTagsHTML = '';
        if (pkg.architectures && pkg.architectures.length > 0) {
            archTagsHTML = pkg.architectures.map(a => `<span class="arch-tag">${a}</span>`).join('');
        } else {
            archTagsHTML = `<span class="arch-tag">${pkg.Architecture || 'all'}</span>`;
        }

        const card = document.createElement('div');
        card.className = 'package-card';
        card.innerHTML = `
            <h2><a href="https://github.com/SjnExe/RepoExe/releases/tag/${pkg.Package}" target="_blank" style="color: inherit; text-decoration: none;">${pkg.Package}</a> <span>v${pkg.Version}</span></h2>
            <p>${pkg.Description}</p>
            <div class="pkg-meta">
                <div class="arch-tags">${archTagsHTML}</div>
            </div>

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

    displayedCount += toRender.length;
}

window.onscroll = function() {
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
        if (displayedCount < currentRenderList.length) {
            renderPackages(currentRenderList, true);
        }
    }

    const topBtn = document.getElementById("top-btn");
    if (document.body.scrollTop > 20 || document.documentElement.scrollTop > 20) {
        topBtn.style.display = "block";
    } else {
        topBtn.style.display = "none";
    }
};

function scrollToTop() {
    window.scrollTo({top: 0, behavior: 'smooth'});
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
        icon.textContent = 'grid_view';
    } else {
        container.classList.replace('list-view', 'grid-view');
        icon.textContent = 'view_list';
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
}

function copyInstallCmd(cmd) {
    copyToClipboard(cmd);
}

function switchInstallTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    document.querySelector(`.tab-btn[onclick="switchInstallTab('${tabId}')"]`).classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');
}

// Dependency Visualizer Logic
function getDependencies(pkgName) {
    const pkg = allPackages.find(p => p.Package === pkgName);
    if (!pkg || !pkg.Depends) return [];
    // Split by comma and remove version constraints e.g. "python (>= 3.9)"
    return pkg.Depends.split(',').map(d => d.split('(')[0].trim());
}

function buildDepTreeHTML(pkgName, visited = new Set()) {
    const isRepoPkg = allPackages.some(p => p.Package === pkgName);
    const displayName = isRepoPkg ? `<a href="#" onclick="showDependencies('${pkgName}'); return false;" style="color: var(--primary-color);">${pkgName}</a>` : pkgName;

    if (visited.has(pkgName)) return `<li>${displayName} <i>(circular/repeated)</i></li>`;
    visited.add(pkgName);

    const deps = getDependencies(pkgName);
    if (deps.length === 0) return `<li><b>${displayName}</b></li>`;

    let html = `<li><b>${displayName}</b><ul>`;
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
