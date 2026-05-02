import urllib.request
import urllib.error
import json
from typing import Optional, Tuple
import time

def get_latest_github_release(owner: str, repo: str) -> Optional[str]:
    url = f"https://api.github.com/repos/{owner}/{repo}/releases/latest"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode('utf-8'))
            return data.get('tag_name')
    except urllib.error.URLError:
        return None

def get_latest_github_tag(owner: str, repo: str) -> Optional[str]:
    url = f"https://api.github.com/repos/{owner}/{repo}/tags"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode('utf-8'))
            if data and len(data) > 0:
                return data[0].get('name')
    except urllib.error.URLError:
        return None

def get_latest_gitlab_release(domain: str, project_id: str) -> Optional[str]:
    url = f"https://{domain}/api/v4/projects/{urllib.parse.quote(project_id, safe='')}/releases"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode('utf-8'))
            if data and len(data) > 0:
                return data[0].get('tag_name')
    except urllib.error.URLError:
        return None

def get_latest_repology_version(project: str) -> Optional[str]:
    url = f"https://repology.org/api/v1/project/{project}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode('utf-8'))
            # Look for newest version
            newest = None
            for item in data:
                status = item.get('status')
                if status == 'newest':
                    newest = item.get('version')
                    break
            return newest
    except urllib.error.URLError:
        return None

def extract_repo_info(url: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Returns domain, owner, repo."""
    import urllib.parse
    parsed = urllib.parse.urlparse(url)
    if parsed.hostname and (parsed.hostname == 'github.com' or parsed.hostname.endswith('.github.com')):
        parts = parsed.path.strip('/').split('/')
        if len(parts) >= 2:
            return 'github.com', parts[0], parts[1]
    elif parsed.hostname and (parsed.hostname.startswith('gitlab.') or '.gitlab.' in parsed.hostname):
        parts = parsed.path.strip('/').split('/')
        if len(parts) >= 2:
            return parsed.hostname, parts[0], parts[1]
    return None, None, None

def check_package_update(pkg_name: str, pkg_dir: str) -> bool:
    import os
    import yaml
    build_yml_path = os.path.join(pkg_dir, 'build.yml')
    if not os.path.exists(build_yml_path):
        return False

    with open(build_yml_path, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f)

    if not data or not data.get('auto_update', False):
        return False

    current_version = data.get('version')
    homepage = data.get('homepage', '')
    source = data.get('source')

    url_to_check = homepage
    if isinstance(source, list) and len(source) > 0:
        url_to_check = source[0].get('url', homepage)

    domain, owner, repo = extract_repo_info(url_to_check)
    latest_version = None

    if domain == 'github.com':
        latest_version = get_latest_github_release(owner, repo)
        if not latest_version:
            latest_version = get_latest_github_tag(owner, repo)
    elif domain and 'gitlab.' in domain:
        project_id = f"{owner}/{repo}"
        latest_version = get_latest_gitlab_release(domain, project_id)

    if not latest_version:
        # Fallback to repology using package name
        latest_version = get_latest_repology_version(pkg_name)
        time.sleep(1) # Rate limit repology

    if latest_version:
        # normalize
        if latest_version.startswith('v'):
            latest_version = latest_version[1:]

        if latest_version != current_version:
            print(f"Update available for {pkg_name}: {current_version} -> {latest_version}")
            return True

    return False

def main():
    import os
    import sys

    packages_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'packages'))
    if not os.path.exists(packages_dir):
        print(f"Packages dir not found: {packages_dir}")
        sys.exit(1)

    updates_found = []

    for entry in os.listdir(packages_dir):
        pkg_dir = os.path.join(packages_dir, entry)
        if os.path.isdir(pkg_dir):
            if check_package_update(entry, pkg_dir):
                updates_found.append(entry)

    if updates_found:
        print(f"\nFound updates for: {', '.join(updates_found)}")
        sys.exit(0) # In CI, 0 means success (we can run the update tasks)
    else:
        print("\nNo updates found.")
        sys.exit(0)

if __name__ == '__main__':
    main()
