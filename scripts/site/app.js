let packagesData = [];
let activeFormat = 'all';

const copyBtn = document.getElementById('copyBtn');
if (copyBtn) {
  copyBtn.addEventListener('click', () => {
    const cmd = document.getElementById('installCmd').innerText;
    navigator.clipboard.writeText(cmd).then(() => {
      const icon = copyBtn.querySelector('.material-icons');
      const text = document.getElementById('copyText');
      if (icon) icon.innerText = 'check';
      if (text) text.innerText = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        if (icon) icon.innerText = 'content_copy';
        if (text) text.innerText = 'Copy';
        copyBtn.classList.remove('copied');
      }, 2000);
    });
  });
}

function updateInstallCommand() {
  const checkboxes = document.querySelectorAll('.target-cb');
  const selected = Array.from(checkboxes)
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);

  const cmdCode = document.getElementById('installCmd');
  if (!cmdCode) return;

  if (selected.length === 0) {
    cmdCode.innerText = 'curl -sL https://sjnexe.github.io/RepoExe/install | sh';
  } else {
    cmdCode.innerText = `curl -sL https://sjnexe.github.io/RepoExe/install | sh -s -- enable ${selected.join(' ')}`;
  }
}

document.querySelectorAll('.target-cb').forEach((cb) => {
  cb.addEventListener('change', updateInstallCommand);
});

async function loadPackages() {
  try {
    const response = await fetch('packages.json');
    if (!response.ok) throw new Error('Metadata file missing');
    const rawData = await response.json();
    packagesData = Array.isArray(rawData) ? rawData : [];
    renderPackages();
  } catch (e) {
    document.getElementById('packageGrid').innerHTML = "<p class='loading'>No packages metadata available yet.</p>";
  }
}

function renderPackages() {
  const grid = document.getElementById('packageGrid');
  const searchInput = document.getElementById('searchInput');
  const search = searchInput ? searchInput.value.toLowerCase() : '';

  const filtered = packagesData.filter((pkg) => {
    const matchesSearch =
      pkg.name.toLowerCase().includes(search) || (pkg.description && pkg.description.toLowerCase().includes(search));
    const matchesFormat = activeFormat === 'all' || (pkg.formats && pkg.formats.includes(activeFormat));
    return matchesSearch && matchesFormat;
  });

  if (filtered.length === 0) {
    grid.innerHTML = "<p class='loading'>No matching packages found.</p>";
    return;
  }

  grid.innerHTML = filtered
    .map((pkg) => {
      const channelsHtml = (pkg.channels || [])
        .map((ch) => {
          const verStr = `v${ch.version}${ch.revision > 0 ? '-' + ch.revision : ''}`;
          return `<span class="channel-badge"><span class="channel-name">${ch.name}:</span> ${verStr}</span>`;
        })
        .join(' ');

      const formatsHtml = (pkg.formats || [])
        .map((fmt) => {
          const isActive = activeFormat === fmt ? 'format-tag active' : 'format-tag';
          return `<span class="${isActive}">${fmt.toUpperCase()}</span>`;
        })
        .join(' ');

      return `
            <div class="card">
                <div>
                    <div class="card-header">
                        <span class="card-title">${pkg.name}</span>
                        <div class="channels-container">${channelsHtml}</div>
                    </div>
                    <p class="card-desc">${pkg.description || 'RepoExe compiled package'}</p>
                </div>
                <div class="card-meta">
                    <div class="formats-container">${formatsHtml}</div>
                    <span class="arch-tag">Arch: ${pkg.architecture || 'aarch64'}</span>
                </div>
            </div>
        `;
    })
    .join('');
}

const searchEl = document.getElementById('searchInput');
if (searchEl) searchEl.addEventListener('input', renderPackages);

document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    e.target.classList.add('active');
    activeFormat = e.target.getAttribute('data-format');
    renderPackages();
  });
});

updateInstallCommand();
loadPackages();
