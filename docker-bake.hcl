group "default" {
  targets = ["builder", "tester"]
}

target "builder" {
  context = "."
  dockerfile = "scripts/docker/Dockerfile"
  tags = ["ghcr.io/sjnexe/repoexe-builder:latest"]
  cache-from = ["type=gha,scope=repoexe-builder"]
  cache-to = ["type=gha,mode=max,scope=repoexe-builder"]
}

target "tester" {
  context = "."
  dockerfile = "scripts/docker/Dockerfile.tester"
  tags = ["ghcr.io/sjnexe/repoexe-tester:latest"]
  cache-from = ["type=gha,scope=repoexe-tester"]
  cache-to = ["type=gha,mode=max,scope=repoexe-tester"]
}
