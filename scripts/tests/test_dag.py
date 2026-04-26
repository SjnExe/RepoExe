import os
import tempfile
from core.dag import DAG


def test_dag_resolution():
    with tempfile.TemporaryDirectory() as pkgs_dir:
        # Create fake packages
        pkg_a = os.path.join(pkgs_dir, 'pkg_a')
        os.makedirs(pkg_a)
        with open(os.path.join(pkg_a, 'build.yml'), 'w') as f:
            f.write("""
name: pkg_a
version: 1.0.0
description: A
homepage: https://a.com
license: MIT
depends:
  local:
    - pkg_b
    - pkg_c
            """)

        pkg_b = os.path.join(pkgs_dir, 'pkg_b')
        os.makedirs(pkg_b)
        with open(os.path.join(pkg_b, 'build.yml'), 'w') as f:
            f.write("""
name: pkg_b
version: 1.0.0
description: B
homepage: https://b.com
license: MIT
depends:
  local:
    - pkg_c
            """)

        pkg_c = os.path.join(pkgs_dir, 'pkg_c')
        os.makedirs(pkg_c)
        with open(os.path.join(pkg_c, 'build.yml'), 'w') as f:
            f.write("""
name: pkg_c
version: 1.0.0
description: C
homepage: https://c.com
license: MIT
            """)

        dag = DAG(pkgs_dir, arch='aarch64')
        order = dag.get_build_order()
        names = [n.name for n in order]

        assert names == ['pkg_c', 'pkg_b', 'pkg_a']
