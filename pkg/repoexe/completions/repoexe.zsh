#compdef repoexe

_repoexe() {
    local -a commands
    commands=(
        'status:Check RepoExe APT repository status'
        'enable:Enable RepoExe APT repository'
        'disable:Disable RepoExe APT repository'
        'version:Print CLI version'
        'help:Show help menu'
    )

    _arguments -R -A "-*" \
        '(-s --status status)'{-s,--status}'[Check RepoExe APT repository status]' \
        '(-e --enable enable)'{-e,--enable}'[Enable RepoExe APT repository]' \
        '(-d --disable disable)'{-d,--disable}'[Disable RepoExe APT repository]' \
        '(-v --version version)'{-v,--version}'[Print CLI version]' \
        '(-h --help help)'{-h,--help}'[Show help menu]' \
        '1:command:->cmd' \
        '*: :_nothing' && return 0

    case $state in
        cmd)
            _describe -t commands 'repoexe command' commands
            ;;
    esac
}

_repoexe "$@"
