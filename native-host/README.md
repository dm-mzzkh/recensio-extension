# Recensio native messaging host

The Firefox extension can't shell out to `yt-dlp` / `ffmpeg` directly —
WebExtensions are sandboxed. This tiny Python host is the bridge.

## What it does

When the extension saves a clip (markers + Save), background script opens
a one-shot Native Messaging port and sends:

```json
{ "cmd": "clip", "clipId": 42, "videoId": "abc123",
  "startSec": 78.4, "endSec": 102.1 }
```

The host runs:

```bash
video_url=$(yt-dlp -f bv -g https://www.youtube.com/watch?v=abc123)
audio_url=$(yt-dlp -f ba -g https://www.youtube.com/watch?v=abc123)
ffmpeg -y \
  -ss 00:01:18.400 -to 00:01:42.100 -i "$video_url" \
  -ss 00:01:18.400 -to 00:01:42.100 -i "$audio_url" \
  -c:v copy -c:a aac \
  /tmp/recensio-clip-XXXX.mp4
```

Then streams the resulting mp4 back to the extension in base64 chunks
(~700 KB each — under Firefox's per-message limit). The temp file is
deleted at the end. The extension stitches the chunks into a Blob and
writes to IDB, where the editor `<video>` element plays it inline.

## Install

### Linux / macOS

```bash
./install.sh
```

The script copies `com.recensio.ytdl.json` into the right per-user
directory:

- Linux: `~/.mozilla/native-messaging-hosts/`
- macOS: `~/Library/Application Support/Mozilla/NativeMessagingHosts/`

…and points it at the absolute path of `recensio_ytdl.py`. It also
warns if `yt-dlp` or `ffmpeg` aren't on `PATH`.

### Windows (manual)

1. Edit `com.recensio.ytdl.json.tmpl` — replace `__HOST_PATH__` with the
   full path to `recensio_ytdl.py` (forward-slashes are fine), save as
   `com.recensio.ytdl.json` somewhere.
2. Create a registry key
   `HKCU\Software\Mozilla\NativeMessagingHosts\com.recensio.ytdl` whose
   default `(Default)` value is the full path to the JSON file.
3. Ensure `python.exe` is on `PATH`, or change the script's shebang to
   a `.bat` shim that calls Python explicitly.
4. Install `yt-dlp` and `ffmpeg` and put them on `PATH`.

See <https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/Native_messaging>
for the protocol reference.

## Prerequisites

- Python 3.7+ on `PATH`
- `yt-dlp` on `PATH` — `pipx install yt-dlp` or your distro package
- `ffmpeg` on `PATH`

## Uninstall

Delete `com.recensio.ytdl.json` from the directory listed above
(or the registry key on Windows).
