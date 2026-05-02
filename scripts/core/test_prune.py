from core.prune import sort_debian_versions


def test_sort_debian_versions():
    versions = ['1.0', '2.0', '1.5']
    assert sort_debian_versions(versions) == ['1.0', '1.5', '2.0']

    versions_with_epoch = ['1:1.0', '0:2.0', '1:0.5']
    assert sort_debian_versions(versions_with_epoch) == ['0:2.0', '1:0.5', '1:1.0']
