#!/bin/bash
# Sourced by install.sh so the selected tools remain available to the build.

node_ready() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 &&
    node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' &&
    npm --version >/dev/null 2>&1
}

rust_ready() {
  command -v cargo >/dev/null 2>&1 && command -v rustc >/dev/null 2>&1 &&
    cargo --version >/dev/null 2>&1 &&
    rustc --version | awk -v required="$RUST_MINIMUM" '
      $1 == "rustc" {
        seen = 1;
        split($2, actual, "."); split(required, minimum, ".");
        for (i = 1; i <= 3; i++) {
          if (actual[i] + 0 > minimum[i] + 0) exit 0;
          if (actual[i] + 0 < minimum[i] + 0) exit 1;
        }
        exit 0;
      }
      END {if (!seen) exit 1}'
}

# Keep downloads temporary, including on failure. Never execute a partial download.
install_local_node() (
  set -euo pipefail
  local stage arch archive
  case "$(uname -m)" in
    arm64) arch=arm64 ;;
    x86_64) arch=x64 ;;
    *) echo 'このMacのCPU用のNode.js自動導入には対応していません。' >&2; exit 1 ;;
  esac
  stage="$(mktemp -d "$ROOT/.tools/node-download.XXXXXX")"
  trap 'rm -rf "$stage"' EXIT
  curl --proto '=https' --tlsv1.2 -fLsS --retry 3 \
    https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$stage/SHASUMS256.txt"
  archive="$(awk -v suffix="-darwin-$arch.tar.gz" 'index($2, suffix) && substr($2, length($2)-length(suffix)+1) == suffix {print $2; exit}' "$stage/SHASUMS256.txt")"
  if [[ ! "$archive" =~ ^node-v22\.[0-9]+\.[0-9]+-darwin-(arm64|x64)\.tar\.gz$ ]]; then
    echo 'Node.jsのダウンロード情報を確認できませんでした。' >&2; exit 1
  fi
  curl --proto '=https' --tlsv1.2 -fLsS --retry 3 \
    "https://nodejs.org/dist/latest-v22.x/$archive" -o "$stage/$archive"
  awk -v archive="$archive" '$2 == archive {print}' "$stage/SHASUMS256.txt" > "$stage/checksum.txt"
  (cd "$stage" && shasum -a 256 -c checksum.txt)
  mkdir "$stage/unpacked"
  tar -xzf "$stage/$archive" -C "$stage/unpacked" --strip-components=1
  "$stage/unpacked/bin/node" --version
  # Replace only the project-local tools after successful extraction.
  rm -rf "$ROOT/.tools/node"
  mv "$stage/unpacked" "$ROOT/.tools/node"
)

install_local_rust() (
  set -euo pipefail
  local installer
  installer="$(mktemp "$ROOT/.tools/rustup-init.XXXXXX")"
  trap 'rm -f "$installer"' EXIT
  curl --proto '=https' --tlsv1.2 -fLsS --retry 3 https://sh.rustup.rs -o "$installer"
  # Do not modify shell profiles or the user's default Rust installation.
  RUSTUP_INIT_SKIP_PATH_CHECK=yes sh "$installer" -y --no-modify-path \
    --profile minimal --default-toolchain stable
)

setup_environment() {
  echo 'ビルド環境を確認しています…'
  if ! xcrun --find swiftc >/dev/null 2>&1 ||
     ! xcrun --find clang >/dev/null 2>&1 ||
     ! xcrun --sdk macosx --show-sdk-path >/dev/null 2>&1; then
    echo 'Xcode Command Line Toolsのインストール画面を開きます。' >&2
    xcode-select --install || true
    echo '画面でインストールを完了してから、もう一度 ./install.sh を実行してください。' >&2
    return 1
  fi
  if ! xcrun swiftc --version >/dev/null 2>&1 || ! xcrun clang --version >/dev/null 2>&1; then
    echo 'Xcodeのツールを実行できません。表示されるライセンス同意・初期設定を完了してから再実行してください。' >&2
    return 1
  fi
  mkdir -p "$ROOT/.tools"
  if [ -x "$ROOT/.tools/node/bin/node" ]; then
    export PATH="$ROOT/.tools/node/bin:$PATH"
  fi
  if ! node_ready; then
    echo 'Node.js 22（22.12以降）とnpmを .tools/node に準備しています…'
    install_local_node
    export PATH="$ROOT/.tools/node/bin:$PATH"
  fi
  if ! node_ready; then echo 'Node.js・npmの準備に失敗しました。' >&2; return 1; fi

  RUST_MINIMUM="$(sed -n 's/^rust-version = "\([^"]*\)"/\1/p' "$ROOT/src-tauri/Cargo.toml")"
  if [ -z "$RUST_MINIMUM" ]; then echo '必要なRustのバージョンを確認できません。' >&2; return 1; fi
  # Include existing rustup installations that are not yet on this shell's PATH.
  if [ -x "$ROOT/.tools/cargo/bin/cargo" ]; then
    export CARGO_HOME="$ROOT/.tools/cargo" RUSTUP_HOME="$ROOT/.tools/rustup"
    export RUSTUP_TOOLCHAIN=stable
    export PATH="$CARGO_HOME/bin:$PATH"
  elif [ -x "${CARGO_HOME:-$HOME/.cargo}/bin/cargo" ]; then
    export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
  fi
  if ! rust_ready; then
    echo "Rust $RUST_MINIMUM 以降を .tools/ に準備しています…"
    export CARGO_HOME="$ROOT/.tools/cargo" RUSTUP_HOME="$ROOT/.tools/rustup"
    export RUSTUP_TOOLCHAIN=stable
    export PATH="$CARGO_HOME/bin:$PATH"
    if [ -x "$CARGO_HOME/bin/rustup" ]; then
      "$CARGO_HOME/bin/rustup" toolchain install stable --profile minimal
    else
      install_local_rust
    fi
  fi
  if ! rust_ready; then echo "Rust $RUST_MINIMUM 以降の準備に失敗しました。" >&2; return 1; fi
  printf 'Node.js: %s / Rust: %s\n' "$(node --version)" "$(rustc --version)"
  echo 'Tauriを含む依存関係を準備しています…'
  npm ci --include=dev
  npm run tauri -- --version
}
