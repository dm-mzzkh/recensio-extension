#!/usr/bin/env bash
# Install the Recensio native messaging host into the per-user
# Firefox native-messaging-hosts directory.
#
# Run from the repo:
#   ./native-host/install.sh
set -euo pipefail

HOST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_SCRIPT="$HOST_DIR/recensio_ytdl.py"
TMPL="$HOST_DIR/com.recensio.ytdl.json.tmpl"

if [[ ! -f "$HOST_SCRIPT" || ! -f "$TMPL" ]]; then
  echo "missing $HOST_SCRIPT or $TMPL" >&2
  exit 1
fi

chmod +x "$HOST_SCRIPT"

case "$(uname -s)" in
  Linux*)
    DEST="$HOME/.mozilla/native-messaging-hosts"
    ;;
  Darwin*)
    DEST="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
    ;;
  *)
    echo "Unsupported platform: $(uname -s). Configure manually:" >&2
    echo "  Windows: write registry key HKCU\\Software\\Mozilla\\NativeMessagingHosts\\com.recensio.ytdl" >&2
    echo "  See https://mzl.la/native-messaging" >&2
    exit 1
    ;;
esac

mkdir -p "$DEST"
DEST_FILE="$DEST/com.recensio.ytdl.json"

# Substitute the host script path into the manifest template.
ESCAPED=$(printf '%s' "$HOST_SCRIPT" | sed 's/[\/&]/\\&/g')
sed "s/__HOST_PATH__/$ESCAPED/" "$TMPL" > "$DEST_FILE"

echo "Installed: $DEST_FILE"
echo "Pointing at: $HOST_SCRIPT"

# Sanity check binaries.
for bin in yt-dlp ffmpeg; do
  if command -v "$bin" >/dev/null 2>&1; then
    echo "  $bin: $(command -v "$bin")"
  else
    echo "  WARNING: $bin not found in PATH — install it before using Recensio clip downloader" >&2
  fi
done
