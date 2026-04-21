# PowerShell script to build RepoExe packages with Docker.
#
# Usage example:
#
# .\scripts\run-docker.ps1 ./build-package.sh -a arm libandroid-support

Set-Variable -Name IMAGE_NAME -Value "ghcr.io/repoexe/package-builder"
Set-Variable -Name CONTAINER_NAME -Value "repoexe-package-builder"

Write-Output "Running container ${CONTAINER_NAME} from image ${IMAGE_NAME}..."

docker start $CONTAINER_NAME 2>&1 | Out-Null

if (-Not $?) {
    Write-Output "Creating new container..."
    docker run `
        --detach `
        --name $CONTAINER_NAME `
        --volume "${PWD}:/home/builder/repoexe" `
        --tty `
        "$IMAGE_NAME"
}

if ($args.Count -eq 0) {
    docker exec --interactive --tty --user builder $CONTAINER_NAME bash
} else {
    docker exec --interactive --tty --user builder $CONTAINER_NAME $args
}
