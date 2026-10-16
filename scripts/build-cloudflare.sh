#!/usr/bin/env bash
set -euo pipefail

# Cloudflare's build image includes Node, but not necessarily Rust.
# Install the official minimal toolchain in the ephemeral build environment.
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
  source "${CARGO_HOME:-$HOME/.cargo}/env"
fi
rustup target add wasm32-unknown-unknown
npm run build
