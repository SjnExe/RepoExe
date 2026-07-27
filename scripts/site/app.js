let packagesData = [];
let activeFormat = "all";

const copyBtn = document.getElementById("copyBtn");
if (copyBtn) {
    copyBtn.addEventListener("click", () => {
        const cmd = document.getElementById("installCmd").innerText;
        navigator.clipboard.writeText(cmd).then(() => {
            const icon = copyBtn.querySelector(".material-icons");
            const text = document.getElementById("copyText");
            icon.innerText = "check";
            text.innerText = "Copied!";
            copyBtn.classList.add("copied");
            setTimeout(() => {
                icon.innerText = "content_copy";
                text.innerText = "Copy";
                copyBtn.classList.remove("copied");
            }, 2000);
        });
    });
}

async function loadPackages() {
    try {
        const response = await fetch("packages.json");
        if (!response.ok) throw new Error("Metadata file missing");
        packagesData = await response.json();
        renderPackages();
    } catch (e) {
        document.getElementById("packageGrid").innerHTML = "<p class='loading'>No packages metadata available yet.</p>";
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
        grid.innerHTML = "<p class='loading'>No matching packages found.</p>";
        return;
    }

    grid.innerHTML = filtered.map(pkg => `
        <div class="card">
            <div>
                <div class="card-header">
                    <span class="card-title">${pkg.name}</span>
                    <span class="badge">v${pkg.version}</span>
                </div>
                <p class="card-desc">${pkg.description || "RepoExe compiled package"}</p>
            </div>
            <div class="card-meta">
                <span>Format: <strong>${(pkg.format || "apt").toUpperCase()}</strong></span>
                <span>Arch: ${pkg.architecture || "aarch64"}</span>
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