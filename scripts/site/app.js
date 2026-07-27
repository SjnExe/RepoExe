let packagesData = [];
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
