#!/bin/bash
# Isolated setup flow checks; never download tools or change the real environment.
set -euo pipefail
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
for scenario in ready missing old download-failure npm-failure xcode-missing; do
  (
    ROOT="$SANDBOX/$scenario"
    mkdir -p "$ROOT/src-tauri" "$ROOT/fake-bin" "$ROOT/home"
    cp "$PROJECT/src-tauri/Cargo.toml" "$ROOT/src-tauri/"
    export HOME="$ROOT/home" PATH="$ROOT/fake-bin:/usr/bin:/bin:/usr/sbin:/sbin"
    unset CARGO_HOME RUSTUP_HOME RUSTUP_TOOLCHAIN
    export SCENARIO="$scenario" TRACE="$ROOT/trace"
    : > "$TRACE"
    for tool in node npm cargo rustc xcrun xcode-select; do
      cat > "$ROOT/fake-bin/$tool" <<'STUB'
#!/bin/bash
name="${0##*/}"
printf '%s %s\n' "$name" "$*" >> "$TRACE"
case "$name" in
  xcrun) [ "$SCENARIO" != xcode-missing ] ;;
  xcode-select) exit 0 ;;
  node)
    if [ "$1" = -e ]; then [ "$SCENARIO" != missing ] && [ "$SCENARIO" != old ] && [ "$SCENARIO" != download-failure ]; else echo v22.12.0; fi ;;
  npm) if [ "$1" = ci ] && [ "$SCENARIO" = npm-failure ]; then exit 9; fi; echo 10.0.0 ;;
  cargo) [ "$SCENARIO" != missing ] && echo 'cargo 1.99.0' ;;
  rustc) if [ "$SCENARIO" = old ]; then echo 'rustc 1.89.0'; elif [ "$SCENARIO" = missing ]; then exit 1; else echo 'rustc 1.99.0'; fi ;;
esac
STUB
      chmod +x "$ROOT/fake-bin/$tool"
    done
    source "$PROJECT/scripts/setup-environment.sh"
    install_local_node() {
      echo install-node >> "$TRACE"
      if [ "$SCENARIO" = download-failure ]; then return 7; fi
      mkdir -p "$ROOT/.tools/node/bin"
      printf '#!/bin/sh\necho v22.12.0\n' > "$ROOT/.tools/node/bin/node"
      chmod +x "$ROOT/.tools/node/bin/node"
    }
    install_local_rust() {
      echo install-rust >> "$TRACE"
      mkdir -p "$CARGO_HOME/bin"
      printf '#!/bin/sh\necho "rustc 1.99.0"\n' > "$CARGO_HOME/bin/rustc"
      printf '#!/bin/sh\necho "cargo 1.99.0"\n' > "$CARGO_HOME/bin/cargo"
      chmod +x "$CARGO_HOME/bin/"*
    }
    # Run as a top-level command so errexit semantics match install.sh.
    export -f setup_environment node_ready rust_ready install_local_node install_local_rust
    export ROOT
    set +e
    bash -euo pipefail -c setup_environment > "$ROOT/result" 2>&1
    result=$?
    set -e
    case "$scenario" in
      ready)
        [ "$result" = 0 ]
        ! /usr/bin/grep -q install- "$TRACE" ;;
      missing|old)
        [ "$result" = 0 ]
        /usr/bin/grep -q install-node "$TRACE"
        /usr/bin/grep -q install-rust "$TRACE"
        # A second run must reuse both newly installed local tools.
        : > "$TRACE"
        bash -euo pipefail -c setup_environment > "$ROOT/repeated-result" 2>&1
        ! /usr/bin/grep -q install- "$TRACE" ;;
      download-failure|npm-failure)
        [ "$result" != 0 ]
        ! /usr/bin/grep -q 'npm run tauri' "$TRACE" ;;
      xcode-missing)
        [ "$result" != 0 ]
        /usr/bin/grep -q 'xcode-select --install' "$TRACE"
        ! /usr/bin/grep -q install-node "$TRACE"
        ! /usr/bin/grep -q 'npm ci' "$TRACE" ;;
    esac
    if [ "$result" = 0 ]; then
      /usr/bin/grep -q 'npm ci --include=dev' "$TRACE"
      /usr/bin/grep -q 'npm run tauri -- --version' "$TRACE"
    fi
    echo "PASS: $scenario"
  )
done
