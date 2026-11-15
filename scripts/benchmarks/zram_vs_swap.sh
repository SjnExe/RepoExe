#!/usr/bin/env bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_PATH="/tmp/mem_tester"

echo "=== Compiling Memory Exerciser ==="
gcc -O2 -Wall "${SCRIPT_DIR}/mem_tester.c" -o "${BIN_PATH}"

# Runner info
TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_RAM_GB=$(awk -v k="$TOTAL_RAM_KB" 'BEGIN {printf "%.1f", k/1048576}')
echo "Host RAM: ${TOTAL_RAM_GB} GB (${TOTAL_RAM_KB} KB)"

cleanup() {
  echo "🧹 Running cleanup..."
  sudo swapoff /swapfile_bench 2>/dev/null || true
  sudo rm -f /swapfile_bench 2>/dev/null || true
  sudo swapoff /dev/zram0 2>/dev/null || true
  sudo zramctl --reset /dev/zram0 2>/dev/null || true
  rm -f "${BIN_PATH}"
}
trap cleanup EXIT

# -------------------------------------------------------------
# Test 1: NVMe Swap
# -------------------------------------------------------------
echo ""
echo "=== Phase 1: NVMe Swapfile (4GB) ==="
SWAP_START=$(date +%s%N)
sudo fallocate -l 4G /swapfile_bench
sudo chmod 600 /swapfile_bench
sudo mkswap /swapfile_bench >/dev/null
sudo swapon --priority 10 /swapfile_bench
SWAP_END=$(date +%s%N)
SWAP_SETUP_MS=$(( (SWAP_END - SWAP_START) / 1000000 ))
echo "✓ NVMe Swap initialized in ${SWAP_SETUP_MS} ms"
swapon --show

echo "Running 18GB memory workload..."
SWAP_OUT="$("${BIN_PATH}" 18)"
echo "${SWAP_OUT}"
SWAP_WRITE=$(echo "${SWAP_OUT}" | grep 'WRITE_TIME=' | cut -d= -f2)
SWAP_READ=$(echo "${SWAP_OUT}" | grep 'READ_TIME=' | cut -d= -f2)
SWAP_SYS=$(echo "${SWAP_OUT}" | grep 'SYS_CPU_SEC=' | cut -d= -f2)
SWAP_MAJ=$(echo "${SWAP_OUT}" | grep 'PAGE_FAULTS_MAJ=' | cut -d= -f2)

sudo swapoff /swapfile_bench
sudo rm -f /swapfile_bench

# -------------------------------------------------------------
# Test 2: ZRAM
# -------------------------------------------------------------
echo ""
echo "=== Phase 2: ZRAM Compressed Memory (4GB) ==="
ZRAM_START=$(date +%s%N)
if ! sudo modprobe zram 2>/dev/null; then
  echo "Installing linux-modules-extra for zram support..."
  sudo apt-get update -qq && sudo apt-get install -y -qq "linux-modules-extra-$(uname -r)"
  sudo modprobe zram
fi

sudo zramctl --find --algorithm lz4 --size 4G >/dev/null
sudo mkswap /dev/zram0 >/dev/null
sudo swapon --priority 32767 /dev/zram0
ZRAM_END=$(date +%s%N)
ZRAM_SETUP_MS=$(( (ZRAM_END - ZRAM_START) / 1000000 ))
echo "✓ ZRAM (lz4) initialized in ${ZRAM_SETUP_MS} ms"
swapon --show

echo "Running 18GB memory workload..."
ZRAM_OUT="$("${BIN_PATH}" 18)"
echo "${ZRAM_OUT}"
ZRAM_WRITE=$(echo "${ZRAM_OUT}" | grep 'WRITE_TIME=' | cut -d= -f2)
ZRAM_READ=$(echo "${ZRAM_OUT}" | grep 'READ_TIME=' | cut -d= -f2)
ZRAM_SYS=$(echo "${ZRAM_OUT}" | grep 'SYS_CPU_SEC=' | cut -d= -f2)
ZRAM_MAJ=$(echo "${ZRAM_OUT}" | grep 'PAGE_FAULTS_MAJ=' | cut -d= -f2)

echo "ZRAM Stats:"
zramctl /dev/zram0 || true

sudo swapoff /dev/zram0
sudo zramctl --reset /dev/zram0

# -------------------------------------------------------------
# Summary Report
# -------------------------------------------------------------
SUMMARY="### 📊 Empirical Memory Benchmark: NVMe Swap vs ZRAM

| Metric | NVMe Swap (4GB) | ZRAM (4GB, LZ4) | Analysis |
| :--- | :--- | :--- | :--- |
| **Setup Latency** | \`${SWAP_SETUP_MS} ms\` | \`${ZRAM_SETUP_MS} ms\` | Swap is instant; ZRAM depends on kernel module |
| **Write Time (18GB)** | \`${SWAP_WRITE} s\` | \`${ZRAM_WRITE} s\` | In-memory vs disk paging speed |
| **Readback Time** | \`${SWAP_READ} s\` | \`${ZRAM_READ} s\` | Page fault recovery speed |
| **Kernel CPU Time (sys)** | \`${SWAP_SYS} s\` | \`${ZRAM_SYS} s\` | CPU cycles spent on memory management / compression |
| **Major Page Faults** | \`${SWAP_MAJ}\` | \`${ZRAM_MAJ}\` | Hard faults resolved by swap subsystem |
"

echo ""
echo "${SUMMARY}"

if [ -n "${GITHUB_STEP_SUMMARY}" ]; then
  echo "${SUMMARY}" >> "${GITHUB_STEP_SUMMARY}"
fi
