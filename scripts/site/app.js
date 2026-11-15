let packagesData = [];

// Main Quick Install Copy Button
const copyBtn = document.getElementById('copyBtn');
if (copyBtn) {
  let resetTimer = null;
  copyBtn.addEventListener('click', () => {
    const cmd =
      document.getElementById('installCmd')?.innerText ?? 'curl -sL https://sjnexe.github.io/RepoExe/install | sh';
    navigator.clipboard
      .writeText(cmd)
      .then(() => {
        const copyText = document.getElementById('copyText');
        if (copyText) copyText.innerText = 'Copied!';
        copyBtn.classList.add('copied');
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          if (copyText) copyText.innerText = 'Copy';
          copyBtn.classList.remove('copied');
          resetTimer = null;
        }, 2000);
      })
      .catch(() => {
        const copyText = document.getElementById('copyText');
        if (copyText) copyText.innerText = 'Failed';
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          if (copyText) copyText.innerText = 'Copy';
          resetTimer = null;
        }, 2000);
      });
  });
}

// 1-Click Copy Helper for Package Cards
function copyPkgInstall(pkgName, triggerEl) {
  const cmd = `pkg install ${pkgName}`;
  if (!triggerEl.dataset.defaultSvg) {
    triggerEl.dataset.defaultSvg = triggerEl.innerHTML;
  }
  const defaultSvg = triggerEl.dataset.defaultSvg;

  return navigator.clipboard
    .writeText(cmd)
    .then(() => {
      triggerEl.innerHTML = `<span style="color: var(--term-green); font-size: 0.7rem; font-weight: 600;">✓</span>`;
      if (triggerEl._resetTimer) clearTimeout(triggerEl._resetTimer);
      triggerEl._resetTimer = setTimeout(() => {
        triggerEl.innerHTML = defaultSvg;
        triggerEl._resetTimer = null;
      }, 1500);
    })
    .catch((err) => {
      triggerEl.innerHTML = `<span style="color: var(--term-red); font-size: 0.7rem; font-weight: 600;">✗</span>`;
      triggerEl.title = `Copy failed - run manually: ${cmd}`;
      if (triggerEl._resetTimer) clearTimeout(triggerEl._resetTimer);
      triggerEl._resetTimer = setTimeout(() => {
        triggerEl.innerHTML = defaultSvg;
        triggerEl.title = 'Copy install command';
        triggerEl._resetTimer = null;
      }, 2500);
      throw err;
    });
}
window.copyPkgInstall = copyPkgInstall;

// Load Packages Manifest
async function loadPackages() {
  const grid = document.getElementById('packageGrid');
  try {
    const response = await fetch('packages.json');
    if (!response.ok) throw new Error('Repository metadata missing');
    const rawData = await response.json();
    packagesData = Array.isArray(rawData) ? rawData : [];
    renderPackages();
  } catch {
    if (grid) {
      grid.innerHTML = `
        <div class="term-loading">
          <p style="color: var(--term-red);">Failed to load packages.json</p>
          <p style="color: var(--text-muted); font-size: 0.75rem;">Run 'repoexe status' directly in Termux.</p>
        </div>
      `;
    }
  }
}

// Render Package Cards
function renderPackages() {
  const grid = document.getElementById('packageGrid');
  const searchInput = document.getElementById('searchInput');
  const pkgCount = document.getElementById('pkgCount');
  if (!grid) return;

  const search = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const filtered = packagesData.filter((pkg) => {
    if (!search) return true;
    const nameMatch = pkg.name?.toLowerCase().includes(search);
    const descMatch = pkg.description?.toLowerCase().includes(search);
    const archMatch = pkg.arch?.toLowerCase().includes(search);
    const depsMatch = Array.isArray(pkg.deps) && pkg.deps.some((d) => d.toLowerCase().includes(search));
    return nameMatch || descMatch || archMatch || depsMatch;
  });

  if (pkgCount) {
    pkgCount.innerText = `${filtered.length} package${filtered.length === 1 ? '' : 's'}`;
  }

  if (filtered.length === 0) {
    grid.innerHTML = '';
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'term-loading';
    const msg = document.createElement('p');
    msg.textContent = `No matching packages found for '${search}'.`;
    emptyDiv.appendChild(msg);
    grid.appendChild(emptyDiv);
    return;
  }

  grid.innerHTML = filtered
    .map((pkg) => {
      const verStr = pkg.version ? `v${pkg.version}${pkg.revision > 0 ? '-' + pkg.revision : ''}` : '';
      const arch = pkg.arch || 'aarch64';
      const desc = pkg.description || 'RepoExe compiled Termux package';

      return `
        <article class="pkg-card">
          <div class="pkg-header">
            <div class="pkg-title-row">
              <span class="pkg-name">${pkg.name}</span>
              ${verStr ? `<span class="pkg-ver">${verStr}</span>` : ''}
            </div>
            <p class="pkg-desc">${desc}</p>
          </div>

          <div class="pkg-install-cmd">
            <code>pkg install ${pkg.name}</code>
            <button class="copy-mini" onclick="window.copyPkgInstall('${pkg.name}', this).catch(() => {})" title="Copy install command">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>

          <div class="pkg-meta">
            <span class="pkg-arch">Arch: ${arch}</span>
            <span class="pkg-format">APT (.deb)</span>
          </div>
        </article>
      `;
    })
    .join('');
}

// Search Listener
const searchEl = document.getElementById('searchInput');
if (searchEl) {
  searchEl.addEventListener('input', renderPackages);
}

loadPackages();
