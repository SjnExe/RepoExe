"""YAML Pydantic Parser for RepoExe."""

import yaml
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator

# Standard set of open-source licenses based on legacy Termux standards
ALLOWED_LICENSES = {
    'Apache-2.0',
    'GPL-2.0',
    'GPL-2.0-only',
    'GPL-2.0-or-later',
    'GPL-3.0',
    'GPL-3.0-only',
    'GPL-3.0-or-later',
    'LGPL-2.0',
    'LGPL-2.0-only',
    'LGPL-2.0-or-later',
    'LGPL-2.1',
    'LGPL-2.1-only',
    'LGPL-2.1-or-later',
    'LGPL-3.0',
    'LGPL-3.0-only',
    'LGPL-3.0-or-later',
    'MIT',
    'ISC',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'Zlib',
    'Unlicense',
    'CC0-1.0',
    'MPL-2.0',
    'OFL-1.1',
    'Public Domain',
    'WTFPL',
}


class BuildYml(BaseModel):
    """Pydantic model representing a RepoExe build.yml definition."""

    # Basic fields
    name: str = Field(..., description='The name of the package')
    vars: Dict[str, str] = Field(default_factory=dict, description='Variables for string substitution')
    version: str = Field(..., description="The upstream version of the package. Must NOT start with 'v'")
    revision: int = Field(0, description='The repository revision number for this version')
    description: str = Field(..., description='A short description of the package')
    homepage: str = Field(..., description='The homepage URL of the package')
    license: str = Field(..., description='The SPDX license identifier')

    # Source fields
    source_url: Optional[str] = Field(None, description='The URL to download the source tarball')
    source_sha256: Optional[str] = Field(None, description='The SHA256 checksum of the source tarball')
    source: Optional[str] = Field(None, description="Source type, e.g., 'git' or 'local'")
    git_branch: Optional[str] = Field(None, description="Git branch to clone if source is 'git'")

    # Advanced metadata
    libc: str = Field('bionic', description='The target libc (bionic or glibc)')
    excluded_arches: List[str] = Field(default_factory=list, description='Architectures to skip building')
    platform_independent: bool = Field(False, description='Whether this is an architecture-independent package')
    essential: bool = Field(False, description='Whether this package is essential to the system')

    # Versioning & Updates
    auto_update: bool = Field(False, description='Opt-in to upstream_check.py')

    # Dependencies & Repositories

    # Build Environment & Execution
    build_in_src: bool = Field(False, description='Force build inside the source tree')
    host_build: bool = Field(False, description='Trigger native Linux compilation before cross-compilation')
    isolated_shard: bool = Field(False, description='Route to a dedicated CI runner shard')
    inherits: Optional[str | List[str]] = Field(None, description='Inherit lifecycle blocks from a mixin')
    build_multilib: bool = Field(False, description='Compile 32-bit packages explicitly for 64-bit targets')
    cmake_args: List[str] = Field(default_factory=list, description='Additional CMake arguments')
    meson_args: List[str] = Field(default_factory=list, description='Additional Meson arguments')
    make_args: List[str] = Field(default_factory=list, description='Additional Make arguments')
    anti_build_depends: List[str] = Field(default_factory=list, description='Uninstall conflicting dependencies')

    # Optimizations
    optimize: str = Field('size', description='Optimization level (size, speed, none)')
    lto: bool = Field(False, description='Enable Link-Time Optimization')
    pgo: bool = Field(False, description='Enable Profile-Guided Optimization')

    # Shell Phases
    phases: Dict[str, str] = Field(default_factory=dict, description='Shell snippets for build phases')

    maintainer: Optional[str] = Field(None, description='The maintainer of the package')

    # Package-Manager Specific Overrides
    alpine: Dict[str, Any] = Field(
        default_factory=dict, description='Alpine Linux specific overrides (hooks, triggers)'
    )
    pacman: Dict[str, Any] = Field(default_factory=dict, description='Pacman specific overrides (hooks, groups)')

    # Subpackages
    subpackages: Dict[str, Dict[str, str | List[str]]] = Field(
        default_factory=dict, description='Granular sub-package definitions (e.g. dev, static, etc.)'
    )

    # Packaging Output & Modifiers
    depends: Dict[str, List[str]] = Field(
        default_factory=dict, description='Required dependencies grouped by repository'
    )
    pre_depends: Dict[str, List[str]] = Field(
        default_factory=dict, description='Force dependency installation before unpacking grouped by repository'
    )
    conffiles: List[str] = Field(default_factory=list, description='Config files not to overwrite')
    recommends_doc: bool = Field(True, description='Generate -doc subpackages')
    recommends_locale: bool = Field(True, description='Generate -locale subpackages')
    no_staticsplit: bool = Field(False, description='Disable automatic splitting of static libraries')
    no_shebang_fix: bool = Field(False, description='Disable automated /bin/sh replacements')
    no_shebang_fix_files: List[str] = Field(default_factory=list, description='Files to exclude from shebang fixing')
    no_elf_cleaner: bool = Field(False, description='Disable termux-elf-cleaner execution')
    service_script: List[str] = Field(default_factory=list, description='Service daemon logic for runit')
    alternatives: Dict[str, str] = Field(default_factory=dict, description='Priority-based command symlinking')

    @field_validator('version')
    @classmethod
    def version_must_not_start_with_v(cls, v: str) -> str:
        if v.startswith('v'):
            return v[1:]
        return v

    @property
    def deb_version(self) -> str:
        """Translates the upstream version into a Debian-compatible version string."""
        import re

        version = self.version
        tag_match = re.search(r'([-_])([a-zA-Z]+)(\d*)$', version)
        if tag_match:
            sep = tag_match.group(1)
            tag = tag_match.group(2).lower()
            num = tag_match.group(3)
            orig = f'{sep}{tag_match.group(2)}{num}'
            if tag == 'r':
                version = version.replace(orig, f'+{tag}{num}')
            elif tag in ('rc', 'alpha', 'beta', 'pre'):
                version = version.replace(orig, f'~{tag}{num}')
        return f'{version}-{self.revision}'

    @property
    def pacman_version(self) -> str:
        """Translates the upstream version into a Pacman-compatible version string."""
        import re

        version = self.version
        tag_match = re.search(r'([-_])([a-zA-Z]+)(\d*)$', version)
        if tag_match:
            sep = tag_match.group(1)
            tag = tag_match.group(2).lower()
            num = tag_match.group(3)
            orig = f'{sep}{tag_match.group(2)}{num}'
            version = version.replace(orig, f'.{tag}{num}')

        # Pacman versions cannot contain hyphens
        version = version.replace('-', '.')
        return f'{version}-{self.revision}'

    @property
    def apk_version(self) -> str:
        """Translates the upstream version into an Alpine-compatible version string."""
        import re

        version = self.version
        tag_match = re.search(r'([-_])([a-zA-Z]+)(\d*)$', version)
        if tag_match:
            sep = tag_match.group(1)
            tag = tag_match.group(2).lower()
            num = tag_match.group(3)
            orig = f'{sep}{tag_match.group(2)}{num}'
            if tag == 'r':
                version = version.replace(orig, f'_p{num}')
            elif tag in ('rc', 'alpha', 'beta', 'pre', 'cvs', 'svn', 'git', 'hg'):
                version = version.replace(orig, f'_{tag}{num}')
        return f'{version}-r{self.revision}'

    @field_validator('license')
    @classmethod
    def license_must_be_allowed(cls, v: str) -> str:
        allowed_upper = {lic.upper(): lic for lic in ALLOWED_LICENSES}
        v_upper = v.upper()
        if v_upper not in allowed_upper:
            if not v.lower().startswith('custom:'):
                raise ValueError(
                    f"License '{v}' is not in the allowlist. Use a standard SPDX identifier or 'custom:<name>'."
                )
        return v

    @field_validator('source_url')
    @classmethod
    def validate_github_url(cls, v: Optional[str]) -> Optional[str]:
        if v:
            from urllib.parse import urlparse

            parsed = urlparse(v)
            if parsed.hostname and ('github.com' == parsed.hostname or parsed.hostname.endswith('.github.com')):
                if '/archive/' in parsed.path and '/archive/refs/tags/' not in parsed.path:
                    raise ValueError(
                        "GitHub '/archive/' URLs are highly volatile. Use official release assets "
                        '(/releases/download/) or strict tag archives (/archive/refs/tags/) to ensure SHA256 stability.'
                    )
        return v

    @field_validator('excluded_arches')
    @classmethod
    def validate_excluded_arches(cls, v: List[str]) -> List[str]:
        valid_arches = {'aarch64', 'arm', 'i686', 'x86_64', 'riscv64', 'wasm32-wasi', 'all'}
        for arch in v:
            if arch not in valid_arches:
                raise ValueError(f"Invalid architecture '{arch}' in excluded_arches. Must be one of: {valid_arches}")
        return v

    @field_validator('conffiles', 'no_shebang_fix_files')
    @classmethod
    def validate_relative_paths(cls, v: List[str]) -> List[str]:
        for path in v:
            if path.startswith('/'):
                raise ValueError(f"Path '{path}' must be relative (cannot start with '/')")
        return v

    @field_validator('optimize')
    @classmethod
    def validate_optimization(cls, v: str) -> str:
        if v not in ['size', 'speed', 'none']:
            raise ValueError("optimize must be one of: 'size', 'speed', 'none'")
        return v

    model_config = ConfigDict(extra='forbid')


def parse_build_yml(filepath: str) -> BuildYml:
    """Parses a build.yml file and validates it against the Pydantic schema."""
    with open(filepath, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f)
    if not data:
        raise ValueError(f'File {filepath} is empty or invalid YAML.')

    def replace_str(s: str, variables) -> str:
        def repl(match):
            key = match.group(1)
            if key in variables:
                return str(variables[key])
            return match.group(0)

        import re

        return re.sub(r'\{([a-zA-Z0-9_]+)\}', repl, s)

    def replace_recursive(node, variables):
        if isinstance(node, dict):
            return {k: replace_recursive(v, variables) for k, v in node.items()}
        elif isinstance(node, list):
            return [replace_recursive(v, variables) for v in node]
        elif isinstance(node, str):
            return replace_str(node, variables)
        return node

    # We do iterative replacement over the entire data tree until it stabilizes
    for _ in range(5):
        # Update variables dict with current name, version, and explicit vars
        current_vars = data.get('vars', {}).copy()
        if 'name' in data and isinstance(data['name'], str):
            current_vars['name'] = data['name']
        if 'version' in data and isinstance(data['version'], str):
            current_vars['version'] = data['version']

        new_data = replace_recursive(data, current_vars)
        if new_data == data:
            break
        data = new_data

    build_yml = BuildYml(**data)
    validate_version_bump_from_git(filepath, build_yml)
    return build_yml


def validate_version_bump_from_git(filepath: str, current_yml: BuildYml) -> None:
    """
    Validates that the version or revision was properly incremented by checking
    if a GitHub release tag already exists for the current version string.
    Since we store artifacts in a single GitHub release tag per version,
    if the tag already exists, the version MUST be bumped.
    """
    import subprocess

    current_version = current_yml.version
    current_revision = current_yml.revision

    # Standardize tag format to match release tags (e.g., package_name-version-revision)
    # The actual tag format depends on repository conventions. We will check if any tag
    # matching the current package name and version+revision exists.
    # Termux doesn't use package-specific tags in the main repo usually, but let's check
    # if the artifact/tag for this exact version exists upstream via gh CLI or git tags.
    tag_name = f'{current_yml.name}-{current_version}-{current_revision}'

    try:
        # We only run this check if gh CLI is available and we are in a context where it works
        # or we check git tags locally.
        result = subprocess.run(
            ['git', 'ls-remote', '--tags', 'origin', f'refs/tags/{tag_name}'], capture_output=True, text=True
        )
        if result.returncode == 0 and result.stdout.strip():
            # Tag already exists upstream, meaning this version was already published.
            # We must fail the build.
            raise ValueError(
                f"Version validation failed: Release tag '{tag_name}' already exists upstream. "
                f"You must increment the 'version' or 'revision' in build.yml."
            )

    except FileNotFoundError:
        # Git is not installed, silently skip validation
        pass
