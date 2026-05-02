import argparse
import sys
import os
import yaml

# Fix python path since build.py is in scripts/ but modules are in scripts/core/
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))
from core.parser import parse_build_yml


def cmd_info(args: argparse.Namespace) -> None:
    pkg_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'packages', args.pkg))
    build_yml_path = os.path.join(pkg_dir, 'build.yml')

    if not os.path.exists(build_yml_path):
        print(f"Error: Package '{args.pkg}' not found (missing {build_yml_path})", file=sys.stderr)
        sys.exit(1)

    try:
        pkg = parse_build_yml(build_yml_path)
        print(pkg.model_dump_json(indent=2))
    except Exception as e:
        print(f"Error parsing build.yml for '{args.pkg}': {e}", file=sys.stderr)
        sys.exit(1)


def cmd_list(args: argparse.Namespace) -> None:
    packages_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'packages'))
    if not os.path.exists(packages_dir):
        print(f"Packages directory '{packages_dir}' not found.", file=sys.stderr)
        return

    packages = []
    for entry in os.listdir(packages_dir):
        pkg_dir = os.path.join(packages_dir, entry)
        if os.path.isdir(pkg_dir) and os.path.exists(os.path.join(pkg_dir, 'build.yml')):
            packages.append(entry)

    packages.sort()
    for pkg in packages:
        print(pkg)


def cmd_clean(args: argparse.Namespace) -> None:
    import subprocess

    print('Cleaning up Docker environment...')

    # Remove dangling images
    try:
        print('Removing dangling images...')
        subprocess.run(['docker', 'image', 'prune', '-f'], check=True)
    except subprocess.CalledProcessError:
        print('Warning: Failed to prune docker images.', file=sys.stderr)

    # Remove stopped containers
    try:
        print('Removing stopped containers...')
        subprocess.run(['docker', 'container', 'prune', '-f'], check=True)
    except subprocess.CalledProcessError:
        print('Warning: Failed to prune docker containers.', file=sys.stderr)

    # Can also add specific artifact removal if needed
    print('Cleanup complete.')


def cmd_init(args: argparse.Namespace) -> None:
    pkg_name = args.pkg
    pkg_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'packages', pkg_name))
    build_yml_path = os.path.join(pkg_dir, 'build.yml')

    if os.path.exists(build_yml_path):
        print(f"Error: Package '{pkg_name}' already exists at {build_yml_path}", file=sys.stderr)
        sys.exit(1)

    # Basic interactive prompt if not provided fully via args
    print(f'Initializing new package: {pkg_name}')
    try:
        version = input('Upstream Version (e.g. 1.0.0): ').strip()
        desc = input('Short Description: ').strip()
        homepage = input('Homepage URL: ').strip()
        license_str = input('SPDX License (e.g. MIT, GPL-3.0): ').strip()
        source_url = input('Source Tarball URL (optional): ').strip()
    except EOFError:
        print('\nAborted.')
        sys.exit(1)

    os.makedirs(pkg_dir, exist_ok=True)

    template = {
        'name': pkg_name,
        'version': version or '0.1.0',
        'revision': 0,
        'description': desc or f'The {pkg_name} package',
        'homepage': homepage or f'https://example.com/{pkg_name}',
        'license': license_str or 'MIT',
    }

    if source_url:
        template['source'] = [{'url': source_url, 'sha256': 'INSERT_SHA256_HERE'}]

    with open(build_yml_path, 'w', encoding='utf-8') as f:
        yaml.dump(template, f, sort_keys=False, default_flow_style=False)

    print(f'Created standard template at {build_yml_path}')
    print('Please manually edit the file to add specific dependencies or arguments.')


def cmd_build(args: argparse.Namespace) -> None:
    pkg_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'packages', args.pkg))
    build_yml_path = os.path.join(pkg_dir, 'build.yml')

    if not os.path.exists(build_yml_path):
        print(f"Error: Package '{args.pkg}' not found (missing {build_yml_path})", file=sys.stderr)
        sys.exit(1)

    try:
        pkg = parse_build_yml(build_yml_path)
    except Exception as e:
        print(f"Error parsing build.yml for '{args.pkg}': {e}", file=sys.stderr)
        sys.exit(1)

    if args.dry_run:
        print(f'--- Dry Run Simulation for {pkg.name} ---')
        print(f'Upstream Version : {pkg.version}')
        print(f'Debian Version   : {pkg.deb_version}')
        print(f'Pacman Version   : {pkg.pacman_version}')
        print(f'Alpine Version   : {pkg.apk_version}')
        print(f'Excluded Arches  : {", ".join(pkg.excluded_arches) if pkg.excluded_arches else "None"}')
        print(f'Dependencies     : {", ".join(pkg.depends) if pkg.depends else "None"}')
        print('Evaluation complete. Build is necessary (cache miss logic not implemented yet).')
        return

    print(f'Building {pkg.name} for architecture {args.arch}...')

    import stat
    from core.docker import DockerRunner, DockerConfig
    import core.properties as props

    # props is module
    docker_cfg = DockerConfig()
    runner = DockerRunner(docker_cfg)

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    build_dir = os.path.join(repo_root, '.build', args.pkg)
    os.makedirs(build_dir, exist_ok=True)

    def run_phase(phase_name: str, script_content: str, network_disabled: bool):
        if not script_content or not script_content.strip():
            return

        print(f'\n[{pkg.name}] Executing phase: {phase_name} (Hermetic: {network_disabled})')

        script_header = f'''#!/bin/bash
set -e
export PREFIX="{props.PREFIX}"
export TERMUX_PREFIX="{props.PREFIX}"
export CFLAGS="-I$PREFIX/include"
export LDFLAGS="-L$PREFIX/lib"
'''
        full_script = script_header + script_content

        script_path = os.path.join(build_dir, f'phase_{phase_name}.sh')
        with open(script_path, 'w') as f:
            f.write(full_script)

        os.chmod(script_path, os.stat(script_path).st_mode | stat.S_IEXEC)

        # Calculate the relative path from the repo root to the script
        rel_script_path = os.path.relpath(script_path, repo_root)

        # Run inside docker
        # The working directory inside docker is /home/builder/RepoExe
        container_script_path = f'./{rel_script_path}'

        result = runner.run([container_script_path], capture_output=False, network_disabled=network_disabled)
        if result.returncode != 0:
            print(f"Error: Phase '{phase_name}' failed with return code {result.returncode}", file=sys.stderr)
            sys.exit(1)

    # 1. pre_fetch (Network Enabled)
    run_phase('pre_fetch', pkg.phases.get('pre_fetch', ''), network_disabled=False)

    # All subsequent phases are hermetic (Network Disabled)
    for phase in ['pre_configure', 'configure', 'make', 'install', 'post_install']:
        run_phase(phase, pkg.phases.get(phase, ''), network_disabled=True)

    print(f'\n[{pkg.name}] Build phases completed successfully.')


def cmd_revbump(args: argparse.Namespace) -> None:
    pkg_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'packages', args.pkg))
    build_yml_path = os.path.join(pkg_dir, 'build.yml')

    if not os.path.exists(build_yml_path):
        print(f"Error: Package '{args.pkg}' not found (missing {build_yml_path})", file=sys.stderr)
        sys.exit(1)

    import yaml

    with open(build_yml_path, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f)

    if data is None:
        print(f"Error parsing build.yml for '{args.pkg}'", file=sys.stderr)
        sys.exit(1)

    current_revision = data.get('revision', 0)
    data['revision'] = current_revision + 1

    with open(build_yml_path, 'w', encoding='utf-8') as f:
        yaml.dump(data, f, sort_keys=False, default_flow_style=False)

    print(f'Bumped revision of {args.pkg} to {data["revision"]}')

    if getattr(args, 'dependencies', False):
        print('Note: Cascading bump to dependencies is not yet fully implemented via DAG.')


def cmd_update_checksum(args: argparse.Namespace) -> None:
    pkg_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'packages', args.pkg))
    build_yml_path = os.path.join(pkg_dir, 'build.yml')

    if not os.path.exists(build_yml_path):
        print(f"Error: Package '{args.pkg}' not found (missing {build_yml_path})", file=sys.stderr)
        sys.exit(1)

    import yaml

    with open(build_yml_path, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f)

    if not data.get('source'):
        print(f"Error: Package '{args.pkg}' does not have a source defined.", file=sys.stderr)
        sys.exit(1)

    source = data.get('source')
    if isinstance(source, list) and len(source) > 0:
        url = source[0].get('url')
        if not url:
            print(f"Error: No URL found in source for '{args.pkg}'.", file=sys.stderr)
            sys.exit(1)

        import urllib.request
        import hashlib
        import tempfile

        print(f'Downloading {url} to calculate sha256...')
        try:
            with tempfile.NamedTemporaryFile(delete=False) as tmp_file:
                urllib.request.urlretrieve(url, tmp_file.name)

                sha256_hash = hashlib.sha256()
                with open(tmp_file.name, 'rb') as f2:
                    for byte_block in iter(lambda: f2.read(4096), b''):
                        sha256_hash.update(byte_block)
                new_sha256 = sha256_hash.hexdigest()

            os.remove(tmp_file.name)

            source[0]['sha256'] = new_sha256

            with open(build_yml_path, 'w', encoding='utf-8') as f:
                yaml.dump(data, f, sort_keys=False, default_flow_style=False)

            print(f'Updated sha256 of {args.pkg} to {new_sha256}')

        except Exception as e:
            print(f'Failed to download and calculate sha256: {e}', file=sys.stderr)
            sys.exit(1)
    else:
        print('Error: unsupported source type for update-checksum.', file=sys.stderr)
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description='RepoExe Orchestrator')
    subparsers = parser.add_subparsers(dest='command', required=True, help='Subcommand to run')

    # info
    parser_info = subparsers.add_parser('info', help='Query package metadata')
    parser_info.add_argument('pkg', help='Package name')

    # list
    subparsers.add_parser('list', help='List all packages')

    # clean
    subparsers.add_parser('clean', help='Clean Docker environment')
    # revbump
    parser_revbump = subparsers.add_parser('revbump', help='Automatically increments the revision integer')
    parser_revbump.add_argument('pkg', help='Package name')
    parser_revbump.add_argument('--dependencies', action='store_true', help='Cascade bump to dependencies')

    # update-checksum
    parser_checksum = subparsers.add_parser('update-checksum', help='Automatically fetch source_url and replace sha256')
    parser_checksum.add_argument('pkg', help='Package name')

    # init
    parser_init = subparsers.add_parser('init', help='Initialize a new package template')
    parser_init.add_argument('pkg', help='Package name')

    # build
    parser_build = subparsers.add_parser('build', help='Build a package')
    parser_build.add_argument('pkg', help='Package name')
    parser_build.add_argument('--arch', default='aarch64', help='Target architecture')
    parser_build.add_argument('--dry-run', action='store_true', help='Simulate build evaluation')

    args = parser.parse_args()

    if args.command == 'info':
        cmd_info(args)
    elif args.command == 'list':
        cmd_list(args)
    elif args.command == 'clean':
        cmd_clean(args)
    elif args.command == 'revbump':
        cmd_revbump(args)
    elif args.command == 'update-checksum':
        cmd_update_checksum(args)
    elif args.command == 'init':
        cmd_init(args)
    elif args.command == 'build':
        cmd_build(args)


if __name__ == '__main__':
    main()
