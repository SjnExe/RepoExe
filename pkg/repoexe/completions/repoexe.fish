# fish completion for repoexe

complete -c repoexe -f

complete -c repoexe -n "test (count (commandline -poc)) -eq 1" -a status -d "Check RepoExe APT repository status"
complete -c repoexe -n "test (count (commandline -poc)) -eq 1" -a enable -d "Enable RepoExe APT repository"
complete -c repoexe -n "test (count (commandline -poc)) -eq 1" -a disable -d "Disable RepoExe APT repository"
complete -c repoexe -n "test (count (commandline -poc)) -eq 1" -a version -d "Print version"
complete -c repoexe -n "test (count (commandline -poc)) -eq 1" -a help -d "Show help menu"

complete -c repoexe -n "test (count (commandline -poc)) -eq 1" -s s -l status -d "Check RepoExe APT repository status"
complete -c repoexe -n "test (count (commandline -poc)) -eq 1" -s e -l enable -d "Enable RepoExe APT repository"
complete -c repoexe -n "test (count (commandline -poc)) -eq 1" -s d -l disable -d "Disable RepoExe APT repository"
complete -c repoexe -n "test (count (commandline -poc)) -eq 1" -s v -l version -d "Print version"
complete -c repoexe -n "test (count (commandline -poc)) -eq 1" -s h -l help -d "Show help menu"
