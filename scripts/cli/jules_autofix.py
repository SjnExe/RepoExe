import os
import sys
from pathlib import Path

import requests

_scripts_dir = str(Path(__file__).resolve().parents[1])
if _scripts_dir not in sys.path:
    sys.path.insert(0, _scripts_dir)


def trigger_jules_autofix(
    pkg: str,
    channel: str,
    old_version: str,
    new_version: str,
    branch_name: str,
    error_details: str = "",
) -> bool:
    api_key = os.getenv("JULES_API_KEY", "").strip()
    if not api_key:
        print(
            "[Jules Auto-Fix] JULES_API_KEY secret not found. Skipping auto-fix session creation."
        )
        return False

    repo_slug = os.getenv("GITHUB_REPOSITORY", "SjnExe/RepoExe").strip()
    parts = repo_slug.split("/")
    if len(parts) == 2:
        owner, repo = parts[0], parts[1]
    else:
        owner, repo = "SjnExe", "RepoExe"

    headers = {
        "X-Goog-Api-Key": api_key,
        "Content-Type": "application/json",
    }

    sources_url = "https://jules.googleapis.com/v1alpha/sources"
    source_name = None
    try:
        res = requests.get(sources_url, headers=headers, timeout=15)
        if res.status_code == 200:
            data = res.json()
            sources = data.get("sources", [])
            for s in sources:
                gh_repo = s.get("githubRepo", {})
                if (
                    gh_repo.get("owner", "").lower() == owner.lower()
                    and gh_repo.get("repo", "").lower() == repo.lower()
                ):
                    source_name = s.get("name")
                    break
                if s.get("id") == f"github/{owner}/{repo}":
                    source_name = s.get("name")
                    break
    except requests.RequestException as e:
        print(f"[Jules Auto-Fix] Error querying sources: {e}")

    if not source_name:
        source_name = f"sources/github/{owner}/{repo}"

    prompt = (
        f"Automated package update for '{pkg}' (channel: {channel}) from version {old_version} to {new_version} failed on branch '{branch_name}'.\n"
        f"Error details: {error_details}\n"
        f"Please analyze the package recipe at pkg/{pkg}/pkg.yml and repository configuration, fix any version, source URL, build phase, or dependency issues, and update the PR branch."
    )

    payload = {
        "prompt": prompt,
        "sourceContext": {
            "source": source_name,
            "githubRepoContext": {
                "startingBranch": branch_name,
            },
        },
        "automationMode": "AUTO_CREATE_PR",
        "title": f"Fix automated update failure: {pkg}@{channel} to {new_version}",
    }

    sessions_url = "https://jules.googleapis.com/v1alpha/sessions"
    try:
        res = requests.post(sessions_url, headers=headers, json=payload, timeout=20)
        if res.status_code in (200, 201):
            sess_data = res.json()
            session_id = sess_data.get("id", sess_data.get("name", "unknown"))
            print(
                f"[Jules Auto-Fix] Successfully initiated Jules session: {session_id}"
            )
            return True
        else:
            print(
                f"[Jules Auto-Fix] Failed to create session. HTTP {res.status_code}: {res.text}"
            )
            return False
    except requests.RequestException as e:
        print(f"[Jules Auto-Fix] Exception triggering Jules session: {e}")
        return False


if __name__ == "__main__":
    if len(sys.argv) >= 6:
        p_name = sys.argv[1]
        c_name = sys.argv[2]
        o_ver = sys.argv[3]
        n_ver = sys.argv[4]
        b_name = sys.argv[5]
        errs = sys.argv[6] if len(sys.argv) >= 7 else ""
        trigger_jules_autofix(p_name, c_name, o_ver, n_ver, b_name, errs)
    else:
        print(
            "Usage: python jules_autofix.py <pkg> <channel> <old_version> <new_version> <branch_name> [error_details]"
        )
