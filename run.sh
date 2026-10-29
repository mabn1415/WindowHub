#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -x .tools/cargo/bin/cargo ]; then
  export CARGO_HOME="$PWD/.tools/cargo" RUSTUP_HOME="$PWD/.tools/rustup"
  export PATH="$CARGO_HOME/bin:$PATH"
fi
if ! command -v cargo >/dev/null; then echo 'Rustをインストールしてください: https://rustup.rs'; exit 1; fi
exec npm run tauri -- "${@:-dev}"
