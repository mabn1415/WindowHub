#!/bin/bash
# Build and install WindowHub without changing user settings or TCC permissions.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DEST="${WINDOWHUB_INSTALL_DESTINATION:-/Applications/WindowHub.app}"
LAUNCH="${WINDOWHUB_INSTALL_NO_LAUNCH:-0}"
MODE=build
case "${1:-}" in
  "") ;;
  --use-built) MODE=existing ;;
  --help|-h) printf '%s\n' '使い方: ./install.sh [--use-built]' '既定はソースからビルドしてインストールします。--use-built は作成済みアプリを使います。'; exit 0 ;;
  *) printf '不明な引数: %s\n' "$1" >&2; exit 2 ;;
esac
if [ "$#" -gt 1 ]; then echo '引数は1つまでです。' >&2; exit 2; fi
if [ "$(uname -s)" != Darwin ]; then echo 'このインストーラーはmacOS用です。' >&2; exit 1; fi
cd "$ROOT"
if [ "$MODE" = build ]; then
  for cmd in node npm xcrun swiftc; do
    if ! command -v "$cmd" >/dev/null 2>&1; then printf '%s が必要です。READMEの事前準備を確認してください。\n' "$cmd" >&2; exit 1; fi
  done
  if ! xcrun --find swiftc >/dev/null 2>&1; then echo 'Xcode Command Line Toolsが必要です。' >&2; exit 1; fi
  if ! "$ROOT/run.sh" --help >/dev/null 2>&1; then echo 'RustまたはTauriの準備ができていません。READMEを確認してください。' >&2; exit 1; fi
  echo '依存関係を準備しています…'
  npm ci
  echo 'WindowHubをビルドしています…'
  ./run.sh build --bundles app
fi
SOURCE="$ROOT/src-tauri/target/release/bundle/macos/WindowHub.app"
if [ ! -d "$SOURCE" ]; then echo 'ビルド済みアプリがありません。--use-builtを外して実行してください。' >&2; exit 1; fi
if [ ! -x "$SOURCE/Contents/MacOS/windowhub" ] || [ ! -x "$SOURCE/Contents/Resources/WindowHubBridge" ]; then echo 'ビルド済みアプリに必要なファイルがありません。' >&2; exit 1; fi
codesign --verify --deep --strict "$SOURCE"
PARENT="$(dirname "$DEST")"
if [ ! -d "$PARENT" ] || [ ! -w "$PARENT" ]; then printf '書き込めません: %s\n' "$PARENT" >&2; exit 1; fi
if [ -L "$DEST" ]; then echo 'インストール先がシンボリックリンクのため中止しました。' >&2; exit 1; fi
if [ -e "$DEST" ]; then
  if [ ! -d "$DEST" ] || [ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$DEST/Contents/Info.plist" 2>/dev/null || true)" != local.windowhub.desktop ]; then
    printf '別のファイルがあるため上書きしません: %s\n' "$DEST" >&2; exit 1
  fi
  if diff -qr "$SOURCE/Contents" "$DEST/Contents" >/dev/null 2>&1; then
    echo '同じアプリがインストール済みです。再配置を省略します。'
    if [ "$LAUNCH" != 1 ]; then open "$DEST"; fi
    exit 0
  fi
fi
STAGE="$(mktemp -d "$PARENT/.windowhub-install.XXXXXX")"
cleanup() {
  if [ -e "$STAGE/previous.app" ]; then
    printf '復旧用の元アプリを保持しています: %s/previous.app\n' "$STAGE" >&2
  else
    rm -rf "$STAGE"
  fi
}
trap cleanup EXIT
/usr/bin/ditto "$SOURCE" "$STAGE/WindowHub.app"
codesign --verify --deep --strict "$STAGE/WindowHub.app"
if [ -e "$DEST" ]; then
  BACKUP_BASE="$ROOT/work/install-backups"
  mkdir -p "$BACKUP_BASE"
  BACKUP="$(mktemp -d "$BACKUP_BASE/previous.XXXXXX")"
  /usr/bin/ditto "$DEST" "$BACKUP/WindowHub.app"
  echo "以前のアプリを保存しました: $BACKUP/WindowHub.app"
  if [ "$DEST" = /Applications/WindowHub.app ]; then
    # Stop only the installed app, never another app with a similar name.
    pids="$(pgrep -f '^/Applications/WindowHub.app/Contents/MacOS/windowhub$' || true)"
    if [ -n "$pids" ]; then
      kill $pids
      for attempt in 1 2 3 4 5; do
        if ! pgrep -f '^/Applications/WindowHub.app/Contents/MacOS/windowhub$' >/dev/null; then break; fi
        sleep 1
      done
      if pgrep -f '^/Applications/WindowHub.app/Contents/MacOS/windowhub$' >/dev/null; then echo 'WindowHubを終了できないため中止しました。' >&2; exit 1; fi
    fi
  fi
  mv "$DEST" "$STAGE/previous.app"
fi
if ! mv "$STAGE/WindowHub.app" "$DEST"; then
  if [ -e "$STAGE/previous.app" ]; then mv "$STAGE/previous.app" "$DEST"; fi
  echo 'インストールに失敗しました。' >&2; exit 1
fi
if [ -e "$STAGE/previous.app" ]; then rm -rf "$STAGE/previous.app"; fi
echo "インストールしました: $DEST"
if [ "$LAUNCH" != 1 ]; then open "$DEST"; fi
printf '\n%s\n' '次にシステム設定の「プライバシーとセキュリティ → アクセシビリティ」でWindowHubを許可してください。' '更新後に許可がオンでも使えない場合は、WindowHubの登録を削除し、/Applications/WindowHub.app を追加し直してください。' '権限操作とTouch IDはご自身で行ってください。'
