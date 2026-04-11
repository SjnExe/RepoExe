#!/usr/bin/env python3

import os
import sys
import glob
import hashlib
import json
import tarfile
import gzip
import bz2
import lzma
import subprocess
import requests
import yaml
from datetime import datetime, timezone
from pathlib import Path

# Config
BASE_URL = "https://SjnExe.github.io/repoexe"
REPO_URL = "https://github.com/SjnExe/repoexe"

def run_cmd(cmd):
    result = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        print(f"Error running cmd: {cmd}\n{result.stderr}", file=sys.stderr)
        return ""
    return result.stdout.strip()

def hash_file(filepath, algo):
    h = hashlib.new(algo)
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b""):
            h.update(chunk)
    return h.hexdigest()

def extract_control_info(deb_path):
    control_content = run_cmd(f"dpkg-deb -f {deb_path}")
    pkg_info = {}
    lines = control_content.split('\n')
    for line in lines:
        if line.startswith(' '): # Continuation line
            continue
        if ':' in line:
            key, val = line.split(':', 1)
            pkg_info[key.strip()] = val.strip()
    return pkg_info, control_content

def generate_packages(deb_dir, base_output_dir, component, prev_packages_content=None):
    deb_files = glob.glob(os.path.join(deb_dir, '*.deb'))

    # Store packages by architecture: arch -> { packages_content: str, appstream: list }
    arch_data = {}

    for deb in deb_files:
        print(f"Processing {deb}...")
        pkg_info, raw_control = extract_control_info(deb)
        if 'Package' not in pkg_info or 'Architecture' not in pkg_info:
            continue

        pkg_name = pkg_info['Package']
        arch = pkg_info['Architecture']

        # If architecture is 'all', we inject it into every standard repoexe architecture
        target_arches = ['aarch64', 'arm', 'i686', 'x86_64'] if arch == 'all' else [arch]

        for t_arch in target_arches:
            if t_arch not in arch_data:
                arch_data[t_arch] = {"packages": "", "appstream": []}

        size = os.path.getsize(deb)
        sha256 = hash_file(deb, 'sha256')

        # Absolute URL rewrite using GitHub Releases rolling tags
        tag_suffix = "-dev" if component == "dev" else ""
        filename = f"{REPO_URL}/releases/download/{pkg_name}{tag_suffix}/{os.path.basename(deb)}"

        cleaned_control = []
        for line in raw_control.split('\n'):
            if not line.startswith(' Size:') and not line.startswith(' SHA256:') and not line.startswith(' Filename:') and line.strip() != '':
                cleaned_control.append(line)

        cleaned_control.append(f"Filename: {filename}")
        cleaned_control.append(f"Size: {size}")
        cleaned_control.append(f"SHA256: {sha256}")

        # Inject Phased-Update-Percentage if it exists in the repository package directory
        repoexe_json_path = os.path.join(os.environ.get("REPO_ROOT", "."), "packages", pkg_name, "repoexe.json")
        if os.path.exists(repoexe_json_path):
            try:
                with open(repoexe_json_path, 'r') as f:
                    config = json.load(f)
                if "Phased-Update-Percentage" in config:
                    cleaned_control.append(f"Phased-Update-Percentage: {config['Phased-Update-Percentage']}")
            except Exception as e:
                print(f"Warning: Failed to parse {repoexe_json_path}: {e}")

        # AppStream generation collection
        for t_arch in target_arches:
            arch_data[t_arch]["appstream"].append({
                "Type": "desktop-application",
                "ID": f"__COM_REPOEXE_PLACEHOLDER__.{pkg_name}",
                "Name": {"C": pkg_info.get("Package", "")},
                "Summary": {"C": pkg_info.get("Description", "").split('\n')[0]},
                "Version": pkg_info.get("Version", "")
            })

            arch_data[t_arch]["packages"] += '\n'.join(cleaned_control) + "\n\n"

    for arch, data in arch_data.items():
        arch_dir = os.path.join(base_output_dir, f"binary-{arch}")
        os.makedirs(arch_dir, exist_ok=True)

        packages_path = os.path.join(arch_dir, "Packages")
        with open(packages_path, "w") as f:
            f.write(data["packages"])

        # PDiff generation logic
        try:
            resp = requests.get(f"{BASE_URL}/dists/stable/main/binary-{arch}/Packages")
            if resp.status_code == 200:
                prev_packages_content = resp.text
                prev_path = os.path.join(arch_dir, "Packages.old")
                with open(prev_path, "w") as f:
                    f.write(prev_packages_content)

                pdiff_dir = os.path.join(arch_dir, "Packages.diff")
                os.makedirs(pdiff_dir, exist_ok=True)

                date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M.%S")
                pdiff_filename = f"{date_str}.pdiff"
                pdiff_path = os.path.join(pdiff_dir, pdiff_filename)

                result = subprocess.run(["diff", "-e", prev_path, packages_path], stdout=subprocess.PIPE, text=True)
                if result.stdout:
                    with open(pdiff_path, "w") as f:
                        f.write(result.stdout)

                    index_path = os.path.join(pdiff_dir, "Index")
                    pdiff_size = os.path.getsize(pdiff_path)
                    pdiff_sha1 = hash_file(pdiff_path, 'sha1')

                    # Read or generate required Index headers
                    history_lines = []
                    patches_lines = []
                    if os.path.exists(index_path):
                        with open(index_path, 'r') as f:
                            lines = f.readlines()
                        mode = None
                        for line in lines:
                            if line.startswith('SHA1-History:'): mode = 'history'
                            elif line.startswith('SHA1-Patches:'): mode = 'patches'
                            elif line.startswith(' '):
                                if mode == 'history': history_lines.append(line)
                                elif mode == 'patches': patches_lines.append(line)

                    # Update history with current packages state
                    current_size = os.path.getsize(packages_path)
                    current_sha1 = hash_file(packages_path, 'sha1')
                    prev_size = os.path.getsize(prev_path)
                    prev_sha1 = hash_file(prev_path, 'sha1')

                    history_lines.append(f" {prev_sha1} {prev_size} {date_str}\n")
                    patches_lines.append(f" {pdiff_sha1} {pdiff_size} {pdiff_filename}\n")

                    # Keep only last 14 entries to prevent index bloat
                    history_lines = history_lines[-14:]
                    patches_lines = patches_lines[-14:]

                    with open(index_path, "w") as f:
                        f.write(f"SHA1-Current: {current_sha1} {current_size}\n")
                        f.write("SHA1-History:\n")
                        f.writelines(history_lines)
                        f.write("SHA1-Patches:\n")
                        f.writelines(patches_lines)

                os.remove(prev_path)
        except Exception as e:
            print(f"Failed to fetch or generate PDiff for {arch}: {e}")

        # Write compressed Packages
        for ext, mod in [('.gz', gzip), ('.bz2', bz2), ('.xz', lzma)]:
            with open(packages_path, 'rb') as f_in:
                with mod.open(packages_path + ext, 'wb') as f_out:
                    f_out.writelines(f_in)

        # Implement Acquire-By-Hash structure for this architecture
        hash_dir = os.path.join(arch_dir, "by-hash", "SHA256")
        os.makedirs(hash_dir, exist_ok=True)
        for ext in ['', '.gz', '.bz2', '.xz']:
            p_file = packages_path + ext
            if os.path.exists(p_file):
                h = hash_file(p_file, 'sha256')
                target = os.path.join(hash_dir, h)
                # Hardlink to save space, fallback to copy
                try:
                    os.link(p_file, target)
                except OSError:
                    import shutil
                    shutil.copy2(p_file, target)

        # Write AppStream YAML
        dep11_dir = os.path.join(base_output_dir, "dep11")
        os.makedirs(dep11_dir, exist_ok=True)
        appstream_path = os.path.join(dep11_dir, f"Components-{arch}.yml")
        with open(appstream_path, "w") as f:
            yaml.dump(data["appstream"], f, default_flow_style=False)

        with open(appstream_path, 'rb') as f_in:
            with gzip.open(appstream_path + '.gz', 'wb') as f_out:
                f_out.writelines(f_in)

def generate_release(output_dir, components):
    date_str = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S UTC")
    comp_str = " ".join(components)

    release_content = f"""Origin: repoexe
Label: repoexe
Suite: stable
Codename: stable
Date: {date_str}
Architectures: aarch64 arm i686 x86_64 all
Components: {comp_str}
Description: repoexe repoexe Repository
Acquire-By-Hash: yes
"""

    for algo in ['MD5Sum', 'SHA1', 'SHA256']:
        release_content += f"{algo}:\n"
        # Search all generated files
        for root, _, files in os.walk(output_dir):
            for file in files:
                if file in ['Release', 'InRelease', 'Release.gpg']: continue
                filepath = os.path.join(root, file)
                rel_path = os.path.relpath(filepath, output_dir)
                size = os.path.getsize(filepath)
                h = hash_file(filepath, algo.lower() if algo != 'MD5Sum' else 'md5')
                release_content += f" {h} {size} {rel_path}\n"

    release_path = os.path.join(output_dir, "Release")
    with open(release_path, "w") as f:
        f.write(release_content)

    return release_path

def sign_release(release_path):
    # Relies on GPG being configured in the environment prior to running
    passphrase = os.environ.get("GPG_PASSPHRASE", "")
    try:
        if passphrase:
            print("Signing with GPG passphrase...")
            # Use subprocess to pass the passphrase via stdin to avoid hanging on a TTY prompt
            cmd1 = ["gpg", "--pinentry-mode", "loopback", "--passphrase-fd", "0", "--armor", "--detach-sign", "--sign", "--output", f"{release_path}.gpg", release_path]
            subprocess.run(cmd1, input=passphrase, text=True, check=True)

            cmd2 = ["gpg", "--pinentry-mode", "loopback", "--passphrase-fd", "0", "--clearsign", "--output", f"{os.path.dirname(release_path)}/InRelease", release_path]
            subprocess.run(cmd2, input=passphrase, text=True, check=True)
        else:
            print("Signing without passphrase...")
            subprocess.run(["gpg", "--armor", "--detach-sign", "--sign", "--output", f"{release_path}.gpg", release_path], check=True)
            subprocess.run(["gpg", "--clearsign", "--output", f"{os.path.dirname(release_path)}/InRelease", release_path], check=True)
    except subprocess.CalledProcessError as e:
        print(f"Signing skipped or failed: {e}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--debs", required=True, help="Root directory containing component deb folders (e.g., debs/main, debs/dev)")
    parser.add_argument("--out", required=True, help="Output directory for dists/stable")
    args = parser.parse_args()

    # Discover components based on subdirectories in the debs folder
    components = [d for d in os.listdir(args.debs) if os.path.isdir(os.path.join(args.debs, d))]
    if not components:
        print("No components found in debs directory. Assuming 'main'.")
        components = ['main']
        os.makedirs(os.path.join(args.debs, 'main'), exist_ok=True)

    print(f"Discovered components: {components}")

    for comp in components:
        comp_deb_dir = os.path.join(args.debs, comp)
        comp_out_dir = os.path.join(args.out, comp)

        # Simulate fetching previous Packages for PDiff
        prev_packages = None
        try:
            resp = requests.get(f"{BASE_URL}/dists/stable/{comp}/binary-aarch64/Packages")
            if resp.status_code == 200:
                prev_packages = resp.text
        except Exception:
            pass

        print(f"Generating Packages and AppStream for {comp}...")
        generate_packages(comp_deb_dir, comp_out_dir, comp, prev_packages)

    print("Generating Master Release file...")
    release_path = generate_release(args.out, components)

    print("Signing Release...")
    sign_release(release_path)

    print("Metadata generation complete.")
