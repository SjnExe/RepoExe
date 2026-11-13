# Design Specification: Multi-Architecture Smoke Test Runner

* **Author:** Elephant Agent (Antigravity)
* **Status:** Approved (Post-EGM Goldfish Review)
* **Date:** 2026-11-13
* **Target Components:** `scripts/cli/build.ts`, `scripts/docker/Dockerfile.tester`, `.github/workflows/build.yml`

---

## 1. Context & Problem Statement

RepoExe compiles packages targeting Termux Bionic libc across four architectures:
`x86_64`, `aarch64`, `arm`, and `i686` (plus `all` for arch-independent).
All CI jobs execute on standard x86_64 runners (`ubuntu-latest`). Direct host invocation of built binaries fails for foreign architectures due to dynamic linker incompatibility and missing Termux sysroot libraries.

## 2. EGM Goldfish Review Resolutions

The initial draft was stress-tested by `egm-design` and `egm-implementation-readiness`, uncovering critical failure modes that have been resolved in this specification:

1. **Docker-outside-of-Docker (DooD) Host Path Resolution (Blocker Resolved):**
   When `build.ts` executes inside the builder container with `/var/run/docker.sock` mounted, sibling container mounts must resolve against the VM host runner path.
   *Resolution:* Binds use `${process.env.GITHUB_WORKSPACE}/output:/tmp/repoexe-pkg:ro` rather than container-internal relative paths.

2. **Deterministic Package Targeting (Major Resolved):**
   Replaced unbounded wildcard globbing (`dpkg -i *.deb`) with deterministic filename resolution:
   Locate the exact `.deb` artifact for the target package and architecture in `output/` to prevent foreign-arch package collisions.

3. **Container Environment Contract (Major Resolved):**
   Non-interactive sibling executions inject full Termux environment variables:
   `-e PREFIX=/data/data/com.termux/files/usr`
   `-e PATH=/data/data/com.termux/files/usr/bin:/bin:/usr/bin`
   `-e LD_LIBRARY_PATH=/data/data/com.termux/files/usr/lib`
   `-e HOME=/data/data/com.termux/files/home`

4. **Emulation Crash Trapping & Timeouts (Major Resolved):**
   QEMU user-mode emulation incurs 10x–30x execution overhead and potential threading deadlocks.
   *Resolution:* All smoke test executions are bounded by `timeout: 120_000` ms with exit-code classification:
   - Exit 124: Emulation Timeout
   - Exit 132/139: Architecture/QEMU Emulation Crash (SIGILL/SIGSEGV)
   - Non-zero: Package Smoke Test Failure

5. **Graceful Local Termux Fallback:**
   When Docker is absent (e.g. running natively inside Android Termux), tests execute directly via local shell if host architecture matches target architecture.
