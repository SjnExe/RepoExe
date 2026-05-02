import json
import subprocess
from collections import defaultdict
from pathlib import Path


def run_gh_command(args: list[str]) -> str:
    """Run a gh CLI command and return its stdout."""
    result = subprocess.run(['gh'] + args, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def prune_old_assets(tag: str, assets_file: Path) -> None:
    """
    Reads the assets JSON for a given tag, groups assets by version,
    and deletes all assets except those belonging to the latest version.
    """
    if not assets_file.exists():
        print(f'No assets file found for tag {tag}')
        return

    try:
        with open(assets_file, 'r', encoding='utf-8') as f:
            assets = json.load(f)
    except json.JSONDecodeError:
        print(f'Error parsing JSON from {assets_file}')
        return

    if not assets:
        print(f'No assets to process for tag {tag}')
        return

    version_groups = defaultdict(list)
    for asset in assets:
        name = asset.get('name', '')
        label = asset.get('label', '')

        version = None
        if label and label.startswith('version: '):
            version = label[len('version: ') :].strip()
        else:
            print(f"Warning: Asset {name} in {tag} lacks a 'version: ' label.")
            version = 'unknown'

        version_groups[version].append(name)

    if 'unknown' in version_groups and len(version_groups) == 1:
        print(f'Tag {tag}: Could not determine versions cleanly. Skipping pruning.')
        return

    versions = [v for v in version_groups.keys() if v != 'unknown']
    if not versions:
        return

    # Sort versions
    sorted_versions = sort_debian_versions(versions)
    latest_version = sorted_versions[-1]

    print(f'Tag {tag}: Latest version is {latest_version}')

    # Delete assets that don't match the latest version
    for version, names in version_groups.items():
        if version == 'unknown':
            continue
        if version != latest_version:
            for name in names:
                print(f'Tag {tag}: Deleting old asset {name} (version {version})')
                try:
                    run_gh_command(['release', 'delete-asset', tag, name, '--yes'])
                except subprocess.CalledProcessError as e:
                    print(f'Failed to delete {name} from {tag}: {e}')


def sort_debian_versions(versions: list[str]) -> list[str]:
    """Sort versions using dpkg --compare-versions."""
    if not versions:
        return []

    # Simple bubble sort using dpkg
    sorted_v = list(versions)
    n = len(sorted_v)
    for i in range(n):
        for j in range(0, n - i - 1):
            # Returns 0 if true (less than or equal)
            # dpkg --compare-versions A le B
            v1 = sorted_v[j]
            v2 = sorted_v[j + 1]
            try:
                res = subprocess.run(['dpkg', '--compare-versions', v1, 'le', v2])
                if res.returncode != 0:
                    # v1 is NOT <= v2, so v1 > v2, swap them
                    sorted_v[j], sorted_v[j + 1] = sorted_v[j + 1], sorted_v[j]
            except FileNotFoundError:
                # Fallback to string sort if dpkg not found
                return sorted(versions)
    return sorted_v


def check_and_delete_zombie_tags(tags: list[str]) -> None:
    """
    Cross-references tags with local packages/ directory.
    If a tag exists but the package folder does not, delete the release.
    """
    packages_dir = Path('../packages')
    if not packages_dir.exists():
        print('Warning: packages directory not found, skipping zombie check.')
        return

    local_packages = set([p.name for p in packages_dir.iterdir() if p.is_dir()])

    # Infrastructure tags that should never be deleted, even if they aren't in packages/
    protected_tags = {'mirrors', 'latest', 'continuous'}

    for tag in tags:
        if tag in protected_tags:
            continue

        # Assuming the tag name corresponds to the package name directly
        if tag not in local_packages:
            print(f'Tag {tag} is a zombie (no local package found). Deleting release...')
            try:
                run_gh_command(['release', 'delete', tag, '--cleanup-tag', '--yes'])
                print(f'Successfully deleted zombie release {tag}')
            except subprocess.CalledProcessError as e:
                print(f'Failed to delete zombie release {tag}: {e}')


def main():
    try:
        tags_json_str = run_gh_command(['release', 'list', '--limit', '1000', '--json', 'tagName'])
        tags_data = json.loads(tags_json_str)
    except subprocess.CalledProcessError as e:
        print(f'Failed to list releases: {e}')
        return

    tags = [t['tagName'] for t in tags_data]

    # 1. Prune old assets
    artifacts_dir = Path('../artifacts')
    if not artifacts_dir.exists():
        print('No artifacts directory found. Skipping asset pruning.')
    else:
        for tag in tags:
            assets_file = artifacts_dir / f'{tag}_assets.json'
            if assets_file.exists():
                prune_old_assets(tag, assets_file)

    # 2. Check for and delete zombie tags
    check_and_delete_zombie_tags(tags)


if __name__ == '__main__':
    main()
