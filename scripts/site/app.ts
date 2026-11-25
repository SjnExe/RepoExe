import { formatDebianFilenameVersion, formatDebianVersion } from '../core/version.ts';

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
  arches?: string[];
  license: string;
  homepage: string;
  maintainer: string;
  uploaders?: string[] | string;
  component?: string;
  section?: string;
  priority?: string;
  interface?: string;
  tags?: string[];
  formats?: string[];
  deps?: string[];
  recommends?: string[];
  suggests?: string[];
  conflicts?: string[];
  breaks?: string[];
  provides?: string[];
  replaces?: string[];
  verified_built?: boolean;
  assets?: PackageAsset[];
  total_downloads?: number;
}

export type SortMode = 'name' | 'downloads';

const REPO_GITHUB_URL = 'https://github.com/SjnExe/RepoExe';
const DEFAULT_INSTALL_CMD = 'curl -sL https://sjnexe.github.io/RepoExe/install | sh';

let packagesData: PackageItem[] = [];
let packageByLowerName = new Map<string, PackageItem>();
let activeInterfaceFilter = 'all';
let activeSectionFilter = 'all';
let activeSortMode: SortMode = 'name';

const copyResetTimers = new WeakMap<HTMLElement, number>();

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isSafeHttpUrl(url?: string): boolean {
  if (!url) return false;
  return /^https?:\/\/\S+$/i.test(url.trim());
}

export { formatDebianFilenameVersion, formatDebianVersion };

export function formatVersionDisplay(
  pkg: Pick<PackageItem, 'version' | 'revision' | 'epoch'>,
): string {
  if (!pkg.version) return '';
  return `v${formatDebianVersion(pkg)}`;
}

export function getPackageInterface(pkg: Pick<PackageItem, 'interface' | 'component'>): string {
  return (pkg.interface || (pkg.component === 'gui' ? 'gui' : 'cli')).toLowerCase();
}

export function buildFallbackAssetUrl(
  pkg: Pick<PackageItem, 'name' | 'version' | 'revision' | 'epoch'>,
  arch: string,
): string {
  const debVer = formatDebianFilenameVersion(pkg);
  const encodedName = encodeURIComponent(pkg.name);
  const filename = encodeURIComponent(`${pkg.name}_${debVer}_${arch}.deb`);
  return `${REPO_GITHUB_URL}/releases/download/${encodedName}/${filename}`;
}

export function parsePackageHash(hash: string): string | null {
  const trimmed = hash.trim();
  if (!trimmed.startsWith('#/pkg/')) return null;
  try {
    const pkgName = decodeURIComponent(trimmed.slice(6)).trim();
    return pkgName || null;
  } catch {
    return null;
  }
}

export function filterAndSortPackages(
  items: PackageItem[],
  options: {
    search?: string;
    iface?: string;
    section?: string;
    sort?: SortMode;
  },
): PackageItem[] {
  const search = (options.search || '').trim().toLowerCase();
  const iface = (options.iface || 'all').toLowerCase();
  const section = (options.section || 'all').toLowerCase();
  const sort = options.sort || 'name';

  const filtered = items.filter((pkg) => {
    const pkgIface = getPackageInterface(pkg);
    if (iface !== 'all' && pkgIface !== iface && pkgIface !== 'both') {
      return false;
    }
    if (section !== 'all' && (pkg.section || '').toLowerCase() !== section) {
      return false;
    }
    if (!search) return true;

    return (
      pkg.name?.toLowerCase().includes(search) ||
      pkg.description?.toLowerCase().includes(search) ||
      pkg.arch?.toLowerCase().includes(search) ||
      (Array.isArray(pkg.arches) && pkg.arches.some((a) => a.toLowerCase().includes(search))) ||
      pkg.section?.toLowerCase().includes(search) ||
      (Array.isArray(pkg.tags) && pkg.tags.some((t) => t.toLowerCase().includes(search))) ||
      (Array.isArray(pkg.deps) && pkg.deps.some((d) => d.toLowerCase().includes(search))) ||
      pkg.license?.toLowerCase().includes(search)
    );
  });

  if (sort === 'downloads') {
    return [...filtered].sort((a, b) => {
      const diff = (b.total_downloads ?? 0) - (a.total_downloads ?? 0);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
  }

  return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
}

function formatUser(userStr: string): string {
  if (!userStr) return '';
  const trimmed = userStr.trim();
  if (trimmed.startsWith('@') && trimmed.length > 1) {
    const handle = trimmed.slice(1);
    return `<a href="https://github.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener" class="author-link">${escapeHtml(trimmed)}</a>`;
  }
  return escapeHtml(trimmed);
}

async function writeToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fallback for non-HTTPS or restricted WebView contexts
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!ok) {
    throw new Error('Clipboard copy failed');
  }
}

export async function copyText(text: string, triggerEl: HTMLElement): Promise<void> {
  if (!triggerEl.dataset.defaultHtml) {
    triggerEl.dataset.defaultHtml = triggerEl.innerHTML;
  }
  const defaultHtml = triggerEl.dataset.defaultHtml;

  const existingTimer = copyResetTimers.get(triggerEl);
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer);
  }

  try {
    await writeToClipboard(text);
    triggerEl.classList.add('copied');
    const hasLabel = Boolean(triggerEl.querySelector('span'));
    triggerEl.innerHTML = hasLabel
      ? '<span aria-hidden="true">✓</span><span>Copied!</span>'
      : '<span style="color: var(--term-green); font-size: 0.75rem; font-weight: 600;">✓</span>';

    const timer = window.setTimeout(() => {
      triggerEl.classList.remove('copied');
      triggerEl.innerHTML = defaultHtml;
      copyResetTimers.delete(triggerEl);
    }, 1500);
    copyResetTimers.set(triggerEl, timer);
  } catch (err) {
    triggerEl.classList.remove('copied');
    triggerEl.innerHTML =
      '<span style="color: var(--term-red); font-size: 0.75rem; font-weight: 600;">✗</span>';
    const timer = window.setTimeout(() => {
      triggerEl.innerHTML = defaultHtml;
      copyResetTimers.delete(triggerEl);
    }, 2500);
    copyResetTimers.set(triggerEl, timer);
    throw err;
  }
}

function renderFilterBar(): void {
  const bar = document.getElementById('filterBar');
  if (!bar) return;

  const sections = Array.from(
    new Set(packagesData.map((p) => p.section?.trim()).filter((s): s is string => Boolean(s))),
  ).sort();

  const ifacePills = ['all', 'cli', 'gui']
    .map((val) => {
      const label = val === 'all' ? 'All Interfaces' : val.toUpperCase();
      const isActive = activeInterfaceFilter === val;
      return `<button type="button" class="filter-pill${isActive ? ' active' : ''}" data-filter-iface="${val}" aria-pressed="${isActive}">${label}</button>`;
    })
    .join('');

  const sectionPills = ['all', ...sections]
    .map((val) => {
      const label = val === 'all' ? 'All Sections' : escapeHtml(val);
      const isActive = activeSectionFilter === val;
      return `<button type="button" class="filter-pill${isActive ? ' active' : ''}" data-filter-section="${escapeHtml(val)}" aria-pressed="${isActive}">${label}</button>`;
    })
    .join('');

  bar.innerHTML = `
    <div class="filter-group" role="group" aria-label="Filter by interface">${ifacePills}</div>
    ${sections.length > 0 ? `<div class="filter-group" role="group" aria-label="Filter by section">${sectionPills}</div>` : ''}
  `;
}

function syncFilterBarState(): void {
  const bar = document.getElementById('filterBar');
  if (!bar) return;

  for (const btn of bar.querySelectorAll<HTMLButtonElement>('[data-filter-iface]')) {
    const active = btn.dataset.filterIface === activeInterfaceFilter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
  for (const btn of bar.querySelectorAll<HTMLButtonElement>('[data-filter-section]')) {
    const active = btn.dataset.filterSection === activeSectionFilter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
}

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

  const packageName = clean
    .replace(/\s*\(.*\)\s*$/, '')
    .replace(/\s*\[.*\]\s*$/, '')
    .trim();
  const internalMatch = packageByLowerName.get(packageName.toLowerCase());
  if (internalMatch) {
    return `<a href="#/pkg/${encodeURIComponent(internalMatch.name)}" class="dep-pill internal" title="RepoExe internal package">${escapeHtml(clean)}</a>`;
  }
  return `<a href="https://github.com/termux/termux-packages/tree/master/packages/${encodeURIComponent(packageName)}" target="_blank" rel="noopener" class="dep-pill external" title="Official Termux upstream package">${escapeHtml(clean)} <span class="ext-arrow" aria-hidden="true">↗</span></a>`;
}

function renderRelationSection(
  title: string,
  items?: string[],
  variant: 'internal' | 'warning' = 'internal',
): string {
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

function renderCatalog(): void {
  const grid = document.getElementById('packageGrid');
  const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
  const pkgCount = document.getElementById('pkgCount');
  if (!grid) return;

  const search = searchInput ? searchInput.value.trim() : '';
  const filtered = filterAndSortPackages(packagesData, {
    search,
    iface: activeInterfaceFilter,
    section: activeSectionFilter,
    sort: activeSortMode,
  });

  if (pkgCount) {
    pkgCount.textContent = `${filtered.length} package${filtered.length === 1 ? '' : 's'}`;
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="term-loading">
        <p>No matching packages found${search ? ` for '${escapeHtml(search)}'` : ''}.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered
    .map((pkg) => {
      const verStr = formatVersionDisplay(pkg);
      const pkgIface = getPackageInterface(pkg);
      const desc = pkg.description || 'RepoExe compiled Termux package';
      const downloads = pkg.total_downloads ?? 0;
      const assets = pkg.assets || [];
      const hasMultiArch = assets.length > 1;
      const archList =
        assets.length > 0 ? assets.map((a) => a.arch).join(', ') : pkg.arch || 'aarch64';
      const firstAsset = assets[0];
      const defaultArch = firstAsset?.arch || pkg.arch || 'aarch64';
      const sizeStr = firstAsset?.size_formatted || '';

      const downloadActionUrl = hasMultiArch
        ? `#/pkg/${encodeURIComponent(pkg.name)}`
        : firstAsset?.download_url || buildFallbackAssetUrl(pkg, defaultArch);
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
            <div class="pkg-badges">
              <span class="pkg-badge iface-${escapeHtml(pkgIface)}">${escapeHtml(pkgIface.toUpperCase())}</span>
              ${pkg.section ? `<span class="pkg-badge pkg-section-badge">${escapeHtml(pkg.section)}</span>` : ''}
            </div>
            <p class="pkg-desc">${escapeHtml(desc.split('\n')[0])}</p>
          </div>

          <div class="pkg-install-cmd">
            <code>pkg i ${escapeHtml(pkg.name)}</code>
            <div class="cmd-actions">
              <button type="button" class="copy-mini" data-copy-pkg="${escapeHtml(pkg.name)}" title="Copy install command" aria-label="Copy install command for ${escapeHtml(pkg.name)}">
                <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
              <a href="${escapeHtml(downloadActionUrl)}" class="download-mini" title="${escapeHtml(downloadTitle)}" aria-label="${escapeHtml(downloadTitle)} for ${escapeHtml(pkg.name)}" ${downloadAttrs}>
                <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
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
                <svg aria-hidden="true" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
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

function renderDetailPage(pkgName: string): void {
  const detailView = document.getElementById('detailView');
  const catalogView = document.getElementById('catalogView');
  if (!detailView || !catalogView) return;

  const pkg = packageByLowerName.get(pkgName.toLowerCase());

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
    catalogView.hidden = true;
    detailView.hidden = false;
    return;
  }

  const verStr = formatVersionDisplay(pkg);
  const pkgIface = getPackageInterface(pkg).toUpperCase();
  const uploadersList = Array.isArray(pkg.uploaders)
    ? pkg.uploaders
    : pkg.uploaders
      ? [pkg.uploaders]
      : [];

  const uploadersHtml =
    uploadersList.length > 0 ? uploadersList.map(formatUser).join(', ') : 'None';

  const defaultArch = pkg.arch || 'aarch64';
  const assets =
    pkg.assets && pkg.assets.length > 0
      ? pkg.assets
      : [
          {
            name: `${pkg.name}_${formatDebianFilenameVersion(pkg)}_${defaultArch}.deb`,
            arch: defaultArch,
            download_url: buildFallbackAssetUrl(pkg, defaultArch),
            size_formatted: 'Release Asset',
          },
        ];

  const depsHtml =
    Array.isArray(pkg.deps) && pkg.deps.length > 0
      ? pkg.deps.map((d: string) => renderDependencyTag(d)).join('')
      : '<span class="text-muted">None</span>';

  const homepageHtml = isSafeHttpUrl(pkg.homepage)
    ? `<a href="${escapeHtml(pkg.homepage)}" target="_blank" rel="noopener" class="term-link">${escapeHtml(pkg.homepage)} ↗</a>`
    : pkg.homepage
      ? escapeHtml(pkg.homepage)
      : 'Not provided';

  detailView.innerHTML = `
    <div class="detail-container">
      <nav class="detail-nav">
        <a href="#" class="back-link">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
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
              ${verStr ? `<span class="detail-version">${escapeHtml(verStr)}</span>` : ''}
            </div>
            <div class="detail-downloads-badge" title="Total downloads across all architectures">
              <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
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
              <button type="button" class="term-btn" data-copy-pkg="${escapeHtml(pkg.name)}" title="Copy install command">
                <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
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
                        <svg aria-hidden="true" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                          <polyline points="7 10 12 15 17 10"></polyline>
                          <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        ${ast.download_count ?? 0} downloads
                      </span>
                    </div>
                  </div>
                  <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
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
                <span class="info-val">${homepageHtml}</span>
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
              <div class="info-item">
                <span class="info-label">Component / Interface:</span>
                <span class="info-val">${escapeHtml(pkg.component || 'main')} / ${escapeHtml(pkgIface)}</span>
              </div>
              ${
                pkg.section
                  ? `<div class="info-item">
                <span class="info-label">Section:</span>
                <span class="info-val">${escapeHtml(pkg.section)}</span>
              </div>`
                  : ''
              }
              ${
                Array.isArray(pkg.tags) && pkg.tags.length > 0
                  ? `<div class="info-item">
                <span class="info-label">Tags:</span>
                <span class="info-val">${pkg.tags.map((t) => escapeHtml(t)).join(', ')}</span>
              </div>`
                  : ''
              }
            </div>
          </div>
        </div>
      </section>
    </div>
  `;

  catalogView.hidden = true;
  detailView.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleRoute(): void {
  const catalogView = document.getElementById('catalogView');
  const detailView = document.getElementById('detailView');
  if (!catalogView || !detailView) return;

  const pkgName = parsePackageHash(window.location.hash);
  if (pkgName) {
    renderDetailPage(pkgName);
  } else {
    detailView.hidden = true;
    catalogView.hidden = false;
    renderCatalog();
  }
}

async function loadPackages(): Promise<void> {
  const grid = document.getElementById('packageGrid');
  try {
    const response = await fetch('packages.json');
    if (!response.ok) throw new Error('Repository metadata missing');
    const rawData = await response.json();
    packagesData = Array.isArray(rawData) ? rawData : [];
    packageByLowerName = new Map(packagesData.map((p) => [p.name.toLowerCase(), p]));
    renderFilterBar();
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

function initApp(): void {
  const copyBtn = document.getElementById('copyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const cmd = document.getElementById('installCmd')?.innerText ?? DEFAULT_INSTALL_CMD;
      copyText(cmd, copyBtn).catch(() => {});
    });
  }

  const searchEl = document.getElementById('searchInput');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      if (window.location.hash.startsWith('#/pkg/')) {
        window.location.hash = '';
      }
      renderCatalog();
    });
  }

  const sortSelect = document.getElementById('sortSelect') as HTMLSelectElement | null;
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      activeSortMode = sortSelect.value === 'downloads' ? 'downloads' : 'name';
      renderCatalog();
    });
  }

  window.addEventListener('hashchange', handleRoute);

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const ifaceBtn = target?.closest<HTMLElement>('[data-filter-iface]');
    if (ifaceBtn) {
      activeInterfaceFilter = ifaceBtn.getAttribute('data-filter-iface') || 'all';
      syncFilterBarState();
      renderCatalog();
      return;
    }
    const sectionBtn = target?.closest<HTMLElement>('[data-filter-section]');
    if (sectionBtn) {
      activeSectionFilter = sectionBtn.getAttribute('data-filter-section') || 'all';
      syncFilterBarState();
      renderCatalog();
      return;
    }
    const pkgCopyBtn = target?.closest<HTMLElement>('[data-copy-pkg]');
    if (pkgCopyBtn) {
      const pkg = pkgCopyBtn.getAttribute('data-copy-pkg');
      if (pkg) {
        copyText(`pkg i ${pkg}`, pkgCopyBtn).catch(() => {});
      }
    }
  });

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const isSearchShortcut =
      (e.key === '/' && document.activeElement !== searchEl) ||
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k');

    if (isSearchShortcut) {
      e.preventDefault();
      if (window.location.hash.startsWith('#/pkg/')) {
        window.location.hash = '';
        handleRoute();
      }
      searchEl?.focus();
    }
  });

  loadPackages();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  initApp();
}
