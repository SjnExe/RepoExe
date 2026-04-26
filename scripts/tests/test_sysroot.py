from core.sysroot import Sysroot


def test_hash_string():
    sysroot = Sysroot(sysroot_dir='/tmp/sysroot_test')
    h = sysroot._hash_string('test')
    assert len(h) == 64


def test_prepare_symlink_farm(tmp_path):
    sysroot_dir = tmp_path / 'sysroot'
    prefix_dir = tmp_path / 'prefix'
    sysroot = Sysroot(sysroot_dir=str(sysroot_dir))

    # create a fake cache entry
    pkg_hash = sysroot._hash_string('test_pkg')
    cache_path = sysroot_dir / pkg_hash
    cache_path.mkdir(parents=True)

    (cache_path / 'test_file.txt').write_text('hello')
    (cache_path / 'bin').mkdir()
    (cache_path / 'bin' / 'exe').write_text('exe')

    # prep farm
    sysroot.prepare_symlink_farm({'test_pkg': pkg_hash}, prefix=str(prefix_dir))

    assert (prefix_dir / 'test_file.txt').is_symlink()
    assert (prefix_dir / 'test_file.txt').read_text() == 'hello'
    assert (prefix_dir / 'bin' / 'exe').is_symlink()
    assert (prefix_dir / 'bin' / 'exe').read_text() == 'exe'
