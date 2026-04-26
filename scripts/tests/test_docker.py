from unittest.mock import patch, MagicMock

from core.docker import DockerConfig, DockerRunner, DockerBackgroundExec


@patch('core.docker.subprocess.Popen')
def test_docker_runner(mock_popen):
    mock_process = MagicMock()
    mock_process.communicate.return_value = ('stdout', 'stderr')
    mock_process.returncode = 0
    mock_popen.return_value = mock_process

    config = DockerConfig(env={'TEST_VAR': '1'})
    runner = DockerRunner(config)

    result = runner.run(['echo', 'hello'], capture_output=True, network_disabled=True)

    assert result.returncode == 0
    assert result.stdout == 'stdout'
    assert result.stderr == 'stderr'

    # Verify the built command structure
    called_args = mock_popen.call_args[0][0]
    assert 'docker' in called_args
    assert 'run' in called_args
    assert '--rm' in called_args
    assert '--user=1000:1000' in called_args
    assert '--network=none' in called_args
    assert '-e' in called_args
    assert 'TEST_VAR=1' in called_args
    assert 'echo' in called_args
    assert 'hello' in called_args


@patch('core.docker.subprocess.run')
@patch('core.docker.subprocess.Popen')
def test_docker_background_exec(mock_popen, mock_run):
    mock_process = MagicMock()
    mock_process.communicate.return_value = ('out', 'err')
    mock_process.returncode = 0
    mock_popen.return_value = mock_process

    config = DockerConfig()
    bg = DockerBackgroundExec(config)

    bg.start()
    mock_run.assert_called_once()

    result = bg.exec(['ls', '-la'])
    assert result.returncode == 0

    bg.stop()
    assert mock_run.call_count == 2
