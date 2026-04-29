#!/usr/bin/env python3
import os
import subprocess
import sys


def main():
    pkg_config = os.environ.get("PKG_CONFIG", "pkg-config")

    libraries = [
        "absl_check",
        "absl_log",
        "absl_algorithm",
        "absl_base",
        "absl_bind_front",
        "absl_bits",
        "absl_btree",
        "absl_cleanup",
        "absl_cord",
        "absl_core_headers",
        "absl_debugging",
        "absl_die_if_null",
        "absl_dynamic_annotations",
        "absl_flags",
        "absl_flat_hash_map",
        "absl_flat_hash_set",
        "absl_function_ref",
        "absl_hash",
        "absl_layout",
        "absl_log_initialize",
        "absl_log_severity",
        "absl_memory",
        "absl_node_hash_map",
        "absl_node_hash_set",
        "absl_optional",
        "absl_span",
        "absl_status",
        "absl_statusor",
        "absl_strings",
        "absl_synchronization",
        "absl_time",
        "absl_type_traits",
        "absl_utility",
        "absl_variant",
    ]

    cmd = [pkg_config, "--libs"] + libraries

    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, text=True, check=True)
        print(result.stdout.strip())
    except subprocess.CalledProcessError as e:
        print(f"Error running pkg-config: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
