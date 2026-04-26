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


def test_dag_sharding():
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
isolated_shard: true
            """)

        pkg_d = os.path.join(pkgs_dir, 'pkg_d')
        os.makedirs(pkg_d)
        with open(os.path.join(pkg_d, 'build.yml'), 'w') as f:
            f.write("""
name: pkg_d
version: 1.0.0
description: D
homepage: https://d.com
license: MIT
            """)

        dag = DAG(pkgs_dir, arch='aarch64')
        shards = dag.get_shards(num_shards=2)

        # Output shards might look like:
        # [['pkg_b', 'pkg_a'], ['pkg_d'], ['pkg_c']]

        # 'pkg_c' must be in its own shard (it's isolated and has no deps)
        assert ['pkg_c'] in shards

        # 'pkg_b' and 'pkg_a' must be in the same shard
        for shard in shards:
            if 'pkg_a' in shard:
                assert 'pkg_b' in shard
