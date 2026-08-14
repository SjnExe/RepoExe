group "default" {
  targets = ["builder", "tester"]
}

target "builder" {
  context    = "."
  dockerfile = "scripts/docker/Dockerfile"
  platforms  = ["linux/arm64"]
  tags       = ["ghcr.io/sjnexe/repoexe-builder:latest"]
  cache-from = ["type=registry,ref=ghcr.io/sjnexe/repoexe-builder:cache"]
  cache-to   = ["type=registry,ref=ghcr.io/sjnexe/repoexe-builder:cache,mode=max,compression=zstd,compression-level=3,force-compression=true,oci-mediatypes=true"]
  output     = ["type=image,name=ghcr.io/sjnexe/repoexe-builder:latest,push=true,compression=zstd,compression-level=3,force-compression=true,oci-mediatypes=true"]
}

target "tester" {
  context    = "."
  dockerfile = "scripts/docker/Dockerfile.tester"
  platforms  = ["linux/arm64"]
  tags       = ["ghcr.io/sjnexe/repoexe-tester:latest"]
  cache-from = ["type=registry,ref=ghcr.io/sjnexe/repoexe-tester:cache"]
  cache-to   = ["type=registry,ref=ghcr.io/sjnexe/repoexe-tester:cache,mode=max,compression=zstd,compression-level=3,force-compression=true,oci-mediatypes=true"]
  output     = ["type=image,name=ghcr.io/sjnexe/repoexe-tester:latest,push=true,compression=zstd,compression-level=3,force-compression=true,oci-mediatypes=true"]
}
