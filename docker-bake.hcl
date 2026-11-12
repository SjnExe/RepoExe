variable "REPO_OWNER" {
  default = "sjnexe"
}

group "default" {
  targets = ["builder", "tester"]
}

target "builder" {
  context    = "."
  dockerfile = "scripts/docker/Dockerfile.builder"
  platforms  = ["linux/amd64"]
  tags       = ["ghcr.io/${REPO_OWNER}/repoexe-builder:latest"]
  cache-from = ["type=registry,ref=ghcr.io/${REPO_OWNER}/repoexe-builder:cache"]
  cache-to   = ["type=registry,ref=ghcr.io/${REPO_OWNER}/repoexe-builder:cache,mode=max,compression=zstd,compression-level=3,force-compression=true,oci-mediatypes=true"]
}

target "tester" {
  context    = "."
  dockerfile = "scripts/docker/Dockerfile.tester"
  platforms  = ["linux/amd64"]
  tags       = ["ghcr.io/${REPO_OWNER}/repoexe-tester:latest"]
  cache-from = ["type=registry,ref=ghcr.io/${REPO_OWNER}/repoexe-tester:cache"]
  cache-to   = ["type=registry,ref=ghcr.io/${REPO_OWNER}/repoexe-tester:cache,mode=max,compression=zstd,compression-level=3,force-compression=true,oci-mediatypes=true"]
}
