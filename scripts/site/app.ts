export interface PackageAsset {
  name: string;
  arch: string;
  size?: number;
  size_formatted?: string;
  download_url: string;
  download_count?: number;
}

export interface PackageItem {
  name: string;
  version: string;
  revision?: number;
  epoch?: number;
  description: string;
  arch: string;
  license: string;
  homepage: string;
  maintainer: string;
  uploaders?: string[] | string;
  formats?: string[];
  deps?: string[];
  recommends?: string[];
  suggests?: string[];
  conflicts?: string[];
  breaks?: string[];
  provides?: string[];
  replaces?: string[];
  assets?: PackageAsset[];
  total_downloads?: number;
}

declare global {
  interface Window {
    copyText: (text: string, triggerEl: HTMLElement) => Promise<void>;
    copyPkgInstall: (pkgName: string, triggerEl: HTMLElement) => Promise<void>;
  }
}

let packagesData: PackageItem[] = [];

// Format helper to convert GitHub usernames like @SjnExe into clickable links
function formatUser(userStr: string): string {
  if (!userStr) return '';
  const trimmed = userStr.trim();
  if (trimmed.startsWith('@')) {
    const handle = trimmed.slice(1);
    return `<a href="https://github.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener" class="author-link">${escapeHtml(trimmed)}</a>`;
  }
  return escapeHtml(trimmed);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 1-Click Copy Helper
export async function copyText(text: string, triggerEl: HTMLElement): Promise<void> {
  if (!triggerEl.dataset.defaultHtml) {
    triggerEl.dataset.defaultHtml = triggerEl.innerHTML;
  }
  const defaultHtml = triggerEl.dataset.defaultHtml;

  try {
    await navigator.clipboard.writeText(text);
    triggerEl.innerHTML = `<span style="color: var(--term-green); font-size: 0.75rem; font-weight: 600;">✓</span>`;
    const copyTextEl = triggerEl.querySelector('#copyText');
    if (copyTextEl) copyTextEl.textContent = 'Copied!';

    if ((triggerEl as any)._resetTimer) clearTimeout((triggerEl as any)._resetTimer);
    (triggerEl as any)._resetTimer = setTimeout(() => {
      triggerEl.innerHTML = defaultHtml;
      (triggerEl as any)._resetTimer = null;
    }, 1500);
  } catch (err) {
    triggerEl.innerHTML = `<span style="color: var(--term-red); font-size: 0.75rem; font-weight: 600;">✗</span>`;
    if ((triggerEl as any)._resetTimer) clearTimeout((triggerEl as any)._resetTimer);
    (triggerEl as any)._resetTimer = setTimeout(() => {
      triggerEl.innerHTML = defaultHtml;
      (triggerEl as any)._resetTimer = null;
    }, 2500);
    throw err;
  }
}
window.copyText = copyText;

export async function copyPkgInstall(pkgName: string, triggerEl: HTMLElement): Promise<void> {
  const cmd = `pkg i ${pkgName}`;
  return copyText(cmd, triggerEl);
}
window.copyPkgInstall = copyPkgInstall;

// Quick Install Main Copy Button
const copyBtn = document.getElementById('copyBtn');
if (copyBtn) {
  copyBtn.addEventListener('click', () => {
    const cmd =
      document.getElementById('installCmd')?.innerText ?? 'curl -sL https://sjnexe.github.io/RepoExe/install | sh';
    copyText(cmd, copyBtn).catch(() => {});
  });
}

// Render Dependency Links (Internal if exists in RepoExe, External to Termux if upstream)
function renderDependencyTag(depName: string, variant?: 'internal' | 'warning'): string {
  const clean = depName.trim();
  if (clean.includes('|')) {
    return clean
      .split('|')
      .map((part) => renderDependencyTag(part.trim(), variant))
      .join('<span class="dep-or"> | </span>');
  }

  if (variant === 'warning') {
    return `<span class="dep-pill warning" title="Conflict or break package">${escapeHtml(clean)}</span>`;
  }

  const internalMatch = packagesData.find((p) => p.name === clean);
  if (internalMatch) {
    return `<a href="#/pkg/${encodeURIComponent(clean)}" class="dep-pill internal" title="RepoExe internal package">${escapeHtml(clean)}</a>`;
  }
  return `<a href="https://github.com/termux/termux-packages/tree/master/packages/${encodeURIComponent(clean)}" target="_blank" rel="noopener" class="dep-pill external" title="Official Termux upstream package">${escapeHtml(clean)} <span class="ext-arrow">↗</span></a>`;
}

function renderRelationSection(title: string, items?: string[], variant: 'internal' | 'warning' = 'internal'): string {
  if (!items || items.length === 0) return '';
  return `
    <div class="relation-block">
      <h4 class="relation-title">${escapeHtml(title)}</h4>
      <div class="deps-container">
        ${items.map((item) => renderDependencyTag(item, variant)).join('')}
      </div>
    </div>
  `;
}

// Render Package Catalog Grid
function renderCatalog(): void {
  const grid = document.getElementById('packageGrid');
  const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
  const pkgCount = document.getElementById('pkgCount');
  if (!grid) return;

  const search = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const filtered = packagesData.filter((pkg) => {
    if (!search) return true;
    const nameMatch = pkg.name?.toLowerCase().includes(search);
    const descMatch = pkg.description?.toLowerCase().includes(search);
    const archMatch = pkg.arch?.toLowerCase().includes(search);
    const depsMatch = Array.isArray(pkg.deps) && pkg.deps.some((d) => d.toLowerCase().includes(search));
    const licenseMatch = pkg.license?.toLowerCase().includes(search);
    return nameMatch || descMatch || archMatch || depsMatch || licenseMatch;
  });

  if (pkgCount) {
    pkgCount.innerText = `${filtered.length} package${filtered.length === 1 ? '' : 's'}`;
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="term-loading">
        <p>No matching packages found for '${escapeHtml(search)}'.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered
    .map((pkg) => {
      const verStr = pkg.version ? `v${pkg.version}${pkg.revision && pkg.revision > 0 ? '-' + pkg.revision : ''}` : '';
      const desc = pkg.description || 'RepoExe compiled Termux package';
      const downloads = pkg.total_downloads ?? 0;
      const assets = pkg.assets || [];
      const hasMultiArch = assets.length > 1;
      const archList = assets.length > 0 ? assets.map((a) => a.arch).join(', ') : pkg.arch || 'aarch64';
      const firstAsset = assets[0];
      const defaultArch = firstAsset?.arch || pkg.arch || 'aarch64';
      const sizeStr = firstAsset?.size_formatted || '';

      const downloadActionUrl = hasMultiArch
        ? `#/pkg/${encodeURIComponent(pkg.name)}`
        : firstAsset?.download_url ||
          `https://github.com/SjnExe/RepoExe/releases/download/${pkg.name}/${pkg.name}_${pkg.version}_${defaultArch}.deb`;
      const downloadTitle = hasMultiArch
        ? `Select Architecture (${archList})`
        : `Download .deb (${defaultArch}${sizeStr && sizeStr !== 'Release Asset' ? ' - ' + sizeStr : ''})`;
      const downloadAttrs = hasMultiArch ? '' : 'download';

      return `
        <article class="pkg-card">
          <div class="pkg-header">
            <div class="pkg-title-row">
              <a href="#/pkg/${encodeURIComponent(pkg.name)}" class="pkg-name-link">
                <span class="pkg-name">${escapeHtml(pkg.name)}</span>
              </a>
              ${verStr ? `<span class="pkg-ver">${escapeHtml(verStr)}</span>` : ''}
            </div>
            <p class="pkg-desc">${escapeHtml(desc)}</p>
          </div>

          <div class="pkg-install-cmd">
            <code>pkg i ${escapeHtml(pkg.name)}</code>
            <div class="cmd-actions">
              <button class="copy-mini" data-copy-pkg="${escapeHtml(pkg.name)}" title="Copy install command">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
              <a href="${escapeHtml(downloadActionUrl)}" class="download-mini" title="${escapeHtml(downloadTitle)}" ${downloadAttrs}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
              </a>
            </div>
          </div>

          <div class="pkg-meta">
            <div class="pkg-meta-left">
              <span class="pkg-arch" title="${escapeHtml(archList)}">Arch: ${escapeHtml(archList)}</span>
              ${!hasMultiArch && sizeStr && sizeStr !== 'Release Asset' ? `<span class="pkg-size">${escapeHtml(sizeStr)}</span>` : ''}
            </div>
            <div class="pkg-meta-right">
              <span class="pkg-downloads" title="Total downloads across all architectures">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                ${downloads}
              </span>
              <a href="#/pkg/${encodeURIComponent(pkg.name)}" class="pkg-details-link">Details →</a>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

// Render Package Detail Page (SPA route #/pkg/<name>)
function renderDetailPage(pkgName: string): void {
  const detailView = document.getElementById('detailView');
  const catalogView = document.getElementById('catalogView');
  if (!detailView || !catalogView) return;

  const pkg = packagesData.find((p) => p.name.toLowerCase() === pkgName.toLowerCase());

  if (!pkg) {
    detailView.innerHTML = `
      <div class="term-window detail-card">
        <div class="term-titlebar">
          <div class="term-title">Package Not Found</div>
        </div>
        <div class="term-body">
          <p style="color: var(--term-red); margin-bottom: 1rem;">Package '${escapeHtml(pkgName)}' was not found in RepoExe repository.</p>
          <a href="#" class="term-btn">← Back to Catalog</a>
        </div>
      </div>
    `;
    catalogView.style.display = 'none';
    detailView.style.display = 'block';
    return;
  }

  const verStr = pkg.version ? `v${pkg.version}${pkg.revision && pkg.revision > 0 ? '-' + pkg.revision : ''}` : '';
  const uploadersList = Array.isArray(pkg.uploaders) ? pkg.uploaders : pkg.uploaders ? [pkg.uploaders] : [];

  const uploadersHtml = uploadersList.length > 0 ? uploadersList.map(formatUser).join(', ') : 'None';

  const assets =
    pkg.assets && pkg.assets.length > 0
      ? pkg.assets
      : [
          {
            name: `${pkg.name}_${pkg.version}_${pkg.arch || 'aarch64'}.deb`,
            arch: pkg.arch || 'aarch64',
            download_url: `https://github.com/SjnExe/RepoExe/releases/download/${pkg.name}/${pkg.name}_${pkg.version}_${pkg.arch || 'aarch64'}.deb`,
            size_formatted: 'Release Asset',
          },
        ];

  const depsHtml =
    Array.isArray(pkg.deps) && pkg.deps.length > 0
      ? pkg.deps.map((d: string) => renderDependencyTag(d)).join('')
      : '<span class="text-muted">None</span>';

  detailView.innerHTML = `
    <div class="detail-container">
      <nav class="detail-nav">
        <a href="#" class="back-link">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Back to Packages
        </a>
      </nav>

      <section class="term-window detail-card">
        <div class="term-titlebar">
          <div class="term-title">Package Overview</div>
        </div>
        <div class="term-body">
          <div class="detail-header-row">
            <div>
              <h1 class="detail-title">${escapeHtml(pkg.name)}</h1>
              <span class="detail-version">${escapeHtml(verStr)}</span>
            </div>
            <div class="detail-downloads-badge" title="Total downloads across all architectures">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>${pkg.total_downloads ?? 0} downloads</span>
            </div>
          </div>

          <p class="detail-description">${escapeHtml(pkg.description || 'RepoExe compiled Termux package')}</p>

          <div class="detail-section">
            <h3 class="section-title">Install Command</h3>
            <div class="pkg-install-cmd detail-cmd">
              <code>pkg i ${escapeHtml(pkg.name)}</code>
              <button class="term-btn" data-copy-pkg="${escapeHtml(pkg.name)}" title="Copy install command">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>Copy</span>
              </button>
            </div>
          </div>

          <div class="detail-section">
            <h3 class="section-title">Direct Downloads (.deb from GitHub Releases)</h3>
            <div class="download-buttons-grid">
              ${assets
                .map(
                  (ast) => `
                <a href="${escapeHtml(ast.download_url)}" class="asset-download-btn" download>
                  <div class="asset-btn-content">
                    <div class="asset-btn-header">
                      <span class="asset-arch">${escapeHtml(ast.arch)}</span>
                      ${ast.size_formatted && ast.size_formatted !== 'Release Asset' ? `<span class="asset-size">${escapeHtml(ast.size_formatted)}</span>` : ''}
                    </div>
                    <span class="asset-name">${escapeHtml(ast.name)}</span>
                    <div class="asset-meta-row">
                      <span class="asset-dl-count">
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                          <polyline points="7 10 12 15 17 10"></polyline>
                          <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        ${ast.download_count ?? 0} downloads
                      </span>
                    </div>
                  </div>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                </a>
              `,
                )
                .join('')}
            </div>
          </div>

          <div class="detail-section">
            <h3 class="section-title">Dependencies & Relations</h3>
            <div class="relation-blocks-wrapper">
              <div class="relation-block">
                <h4 class="relation-title">Depends</h4>
                <div class="deps-container">
                  ${depsHtml}
                </div>
              </div>
              ${renderRelationSection('Recommends', pkg.recommends)}
              ${renderRelationSection('Suggests', pkg.suggests)}
              ${renderRelationSection('Conflicts', pkg.conflicts, 'warning')}
              ${renderRelationSection('Breaks', pkg.breaks, 'warning')}
              ${renderRelationSection('Provides', pkg.provides)}
              ${renderRelationSection('Replaces', pkg.replaces)}
            </div>
            <p class="deps-legend">
              <span class="legend-item"><span class="legend-dot internal"></span> RepoExe Package</span>
              <span class="legend-item"><span class="legend-dot external"></span> Upstream Termux Package</span>
            </p>
          </div>

          <div class="detail-section">
            <h3 class="section-title">Package Information</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Homepage:</span>
                <span class="info-val">
                  ${pkg.homepage ? `<a href="${escapeHtml(pkg.homepage)}" target="_blank" rel="noopener" class="term-link">${escapeHtml(pkg.homepage)} ↗</a>` : 'Not provided'}
                </span>
              </div>
              <div class="info-item">
                <span class="info-label">License:</span>
                <span class="info-val">${escapeHtml(pkg.license || 'Unknown')}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Maintainer:</span>
                <span class="info-val">${formatUser(pkg.maintainer)}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Uploaders:</span>
                <span class="info-val">${uploadersHtml}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Target Architecture:</span>
                <span class="info-val">${escapeHtml(pkg.arch || 'aarch64')}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;

  catalogView.style.display = 'none';
  detailView.style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Router State Dispatcher
function handleRoute(): void {
  const hash = window.location.hash.trim();
  const catalogView = document.getElementById('catalogView');
  const detailView = document.getElementById('detailView');

  if (!catalogView || !detailView) return;

  if (hash.startsWith('#/pkg/')) {
    const pkgName = decodeURIComponent(hash.slice(6)).trim();
    renderDetailPage(pkgName);
  } else {
    detailView.style.display = 'none';
    catalogView.style.display = 'block';
    renderCatalog();
  }
}

// Load Packages Manifest
async function loadPackages(): Promise<void> {
  const grid = document.getElementById('packageGrid');
  try {
    const response = await fetch('packages.json');
    if (!response.ok) throw new Error('Repository metadata missing');
    const rawData = await response.json();
    packagesData = Array.isArray(rawData) ? rawData : [];
    handleRoute();
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

// Listeners
window.addEventListener('hashchange', handleRoute);

const searchEl = document.getElementById('searchInput');
if (searchEl) {
  searchEl.addEventListener('input', () => {
    // If user searches while on a detail page, navigate to catalog
    if (window.location.hash.startsWith('#/pkg/')) {
      window.location.hash = '';
    }
    renderCatalog();
  });
}

// Delegated Copy Listener for Package Buttons
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement | null;
  const copyBtn = target?.closest<HTMLElement>('[data-copy-pkg]');
  if (copyBtn) {
    const pkg = copyBtn.getAttribute('data-copy-pkg');
    if (pkg) {
      copyPkgInstall(pkg, copyBtn).catch(() => {});
    }
  }
});

// Keyboard shortcut '/' or 'Ctrl+K' to focus search
window.addEventListener('keydown', (e: KeyboardEvent) => {
  const isSearchShortcut =
    (e.key === '/' && document.activeElement !== searchEl) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k');

  if (isSearchShortcut) {
    e.preventDefault();
    if (window.location.hash.startsWith('#/pkg/')) {
      window.location.hash = '';
      handleRoute(); // Synchronously show catalogView before focusing
    }
    searchEl?.focus();
  }
});

loadPackages();
