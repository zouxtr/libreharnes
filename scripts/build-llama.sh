#!/usr/bin/env bash
# Build latest llama.cpp from source, CPU-optimized.
# Run from the LibreHarnes repo root: bash scripts/build-llama.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LLAMA_DIR="$REPO_ROOT/llama.cpp"

echo "[llama.cpp] Ensuring latest source..."
if [ ! -d "$LLAMA_DIR/.git" ]; then
  git clone --depth 1 https://github.com/ggerganov/llama.cpp.git "$LLAMA_DIR"
else
  git -C "$LLAMA_DIR" pull --depth 1 || true
fi

echo "[llama.cpp] Detecting CPU features..."
AVX2=OFF
AVX512=OFF
if grep -q avx2 /proc/cpuinfo 2>/dev/null; then AVX2=ON; fi
if grep -q avx512f /proc/cpuinfo 2>/dev/null; then AVX512=ON; fi
echo "  AVX2=$AVX2  AVX512=$AVX512"

echo "[llama.cpp] Configuring cmake (CPU only, no GPU)..."
cmake -S "$LLAMA_DIR" -B "$LLAMA_DIR/build" \
  -DLLAMA_AVX2="$AVX2" \
  -DLLAMA_AVX512="$AVX512" \
  -DLLAMA_AVX=OFF \
  -DLLAMA_NEON=OFF \
  -DLLAMA_CUDA=OFF \
  -DLLAMA_CLP=OFF \
  -DLLAMA_BUILD_SERVER=ON \
  -DLLAMA_BUILD_TESTS=OFF \
  -DCMAKE_BUILD_TYPE=Release

echo "[llama.cpp] Building llama-server..."
cmake --build "$LLAMA_DIR/build" --config Release --target llama-server -j"$(nproc)"

SERVER_BIN="$LLAMA_DIR/build/bin/llama-server"
if [ -x "$SERVER_BIN" ]; then
  echo "[llama.cpp] Done: $SERVER_BIN"
  echo "    Update harness/config.json to set llamaServer to this path."
else
  echo "[llama.cpp] ERROR: llama-server binary not found at $SERVER_BIN" >&2
  exit 1
fi
