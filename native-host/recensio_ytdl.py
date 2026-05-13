#!/usr/bin/env python3
"""
Recensio native messaging host.

Reads JSON commands from Firefox over stdin (Native Messaging protocol),
shells out to yt-dlp + ffmpeg to download a precise clip via direct CDN
URLs and HTTP byte-range, then streams the resulting mp4 back to the
extension as base64 chunks (~700 KB each — under Firefox's per-message
limit from host to extension).

Protocol (request):
  { "cmd": "clip", "clipId": N, "videoId": "ID",
    "startSec": float, "endSec": float }
  { "cmd": "source-tags", "videoId": "ID", "url": "...", "source": "youtube"|"tiktok" }

Protocol (responses, may be many per request):
  { "cmd": "clip-progress", "clipId": N, "stage": "..." }
  { "cmd": "clip-chunk", "clipId": N, "index": K, "total": T, "b64": "..." }
  { "cmd": "clip-done", "clipId": N, "size": bytes, "mimeType": "video/mp4" }
  { "cmd": "clip-error", "clipId": N, "error": "..." }
  { "cmd": "source-tags-done", "videoId": "ID", "tags": [...] }
  { "cmd": "source-tags-error", "videoId": "ID", "error": "..." }
"""

import base64
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import traceback


# Firefox launches native messaging hosts with a minimal PATH (often just
# /usr/bin:/bin), so binaries installed via Homebrew or Nix are invisible.
# Prepend the common install locations so shutil.which can find them.
_EXTRA_PATHS = [
    '/opt/homebrew/bin',                    # Homebrew (Apple Silicon)
    '/usr/local/bin',                       # Homebrew (Intel) / generic Unix
    '/run/current-system/sw/bin',           # nix-darwin / NixOS
    os.path.expanduser('~/.nix-profile/bin'),  # Nix single-user
    '/nix/var/nix/profiles/default/bin',    # Nix multi-user default profile
]
_existing = os.environ.get('PATH', '').split(os.pathsep)
os.environ['PATH'] = os.pathsep.join(
    [p for p in _EXTRA_PATHS if p and p not in _existing] + _existing
)


CHUNK_BYTES = 700 * 1024


def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    length = struct.unpack('<I', raw)[0]
    data = sys.stdin.buffer.read(length)
    if len(data) < length:
        return None
    return json.loads(data.decode('utf-8'))


def send_message(obj):
    data = json.dumps(obj, separators=(',', ':')).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def fmt_ts(sec: float) -> str:
    if sec < 0:
        sec = 0.0
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def resolve_bin(name: str) -> str:
    found = shutil.which(name)
    if not found:
        raise RuntimeError(f"{name} not found in PATH")
    return found


def yt_dlp_url(yt_dlp: str, video_url: str, fmt: str) -> str:
    proc = subprocess.run(
        [yt_dlp, '-f', fmt, '-g', video_url],
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode(errors='replace').strip() or 'yt-dlp failed'
        raise RuntimeError(f"yt-dlp -f {fmt}: {err}")
    out = proc.stdout.decode().strip()
    if not out:
        raise RuntimeError(f"yt-dlp -f {fmt}: empty url")
    return out


_HASHTAG_RE = re.compile(r'#([A-Za-z0-9_À-￿]+)')


def yt_dlp_json(yt_dlp: str, video_url: str) -> dict:
    """Run `yt-dlp -J URL` and return parsed metadata JSON.

    `--no-warnings` keeps stderr quiet on normal pulls but we still capture
    it so a real failure (e.g. private video, geo-block) gets surfaced.
    """
    proc = subprocess.run(
        [yt_dlp, '-J', '--no-warnings', '--skip-download', video_url],
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        err = proc.stderr.decode(errors='replace').strip() or 'yt-dlp -J failed'
        raise RuntimeError(err)
    raw = proc.stdout.decode(errors='replace').strip()
    if not raw:
        raise RuntimeError('yt-dlp -J: empty output')
    return json.loads(raw)


def process_source_tags(msg):
    video_id = msg['videoId']
    url = msg['url']
    source = msg.get('source') or 'youtube'

    yt_dlp = resolve_bin('yt-dlp')
    data = yt_dlp_json(yt_dlp, url)

    tags: list[str]
    if source == 'youtube':
        # YouTube exposes a curated `tags` array. Fall back to hashtags in the
        # description for videos where the uploader skipped the tags field.
        raw_tags = data.get('tags') or []
        tags = [t for t in raw_tags if isinstance(t, str) and t.strip()]
        if not tags:
            desc = data.get('description') or ''
            tags = _HASHTAG_RE.findall(desc)
    else:
        # TikTok descriptions are the canonical tag source: `#tag` literals.
        desc = data.get('description') or ''
        tags = _HASHTAG_RE.findall(desc)

    send_message({
        'cmd': 'source-tags-done',
        'videoId': video_id,
        'tags': tags,
    })


def process_clip(msg):
    clip_id = msg['clipId']
    video_id = msg['videoId']
    start_sec = float(msg['startSec'])
    end_sec = float(msg['endSec'])
    yt_url = f"https://www.youtube.com/watch?v={video_id}"

    yt_dlp = resolve_bin('yt-dlp')
    ffmpeg = resolve_bin('ffmpeg')

    send_message({'cmd': 'clip-progress', 'clipId': clip_id, 'stage': 'resolving urls'})
    video_url = yt_dlp_url(yt_dlp, yt_url, 'bv')
    audio_url = yt_dlp_url(yt_dlp, yt_url, 'ba')

    ss = fmt_ts(start_sec)
    to = fmt_ts(end_sec)

    tmp = tempfile.NamedTemporaryFile(prefix='recensio-clip-', suffix='.mp4', delete=False)
    out_path = tmp.name
    tmp.close()

    try:
        send_message({'cmd': 'clip-progress', 'clipId': clip_id, 'stage': 'ffmpeg cutting'})
        proc = subprocess.run(
            [
                ffmpeg, '-y', '-hide_banner', '-loglevel', 'error',
                '-ss', ss, '-to', to, '-i', video_url,
                '-ss', ss, '-to', to, '-i', audio_url,
                '-c:v', 'copy', '-c:a', 'aac',
                out_path,
            ],
            capture_output=True,
            check=False,
        )
        if proc.returncode != 0:
            err = proc.stderr.decode(errors='replace').strip() or 'ffmpeg failed'
            raise RuntimeError(f"ffmpeg: {err}")

        size = os.path.getsize(out_path)
        if size == 0:
            raise RuntimeError('ffmpeg produced empty file')

        total = (size + CHUNK_BYTES - 1) // CHUNK_BYTES
        send_message({
            'cmd': 'clip-progress',
            'clipId': clip_id,
            'stage': f'streaming {total} chunks ({size} bytes)',
        })

        with open(out_path, 'rb') as f:
            for idx in range(total):
                chunk = f.read(CHUNK_BYTES)
                send_message({
                    'cmd': 'clip-chunk',
                    'clipId': clip_id,
                    'index': idx,
                    'total': total,
                    'b64': base64.b64encode(chunk).decode('ascii'),
                })

        send_message({
            'cmd': 'clip-done',
            'clipId': clip_id,
            'size': size,
            'mimeType': 'video/mp4',
        })
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass


def main():
    while True:
        msg = read_message()
        if msg is None:
            return
        try:
            cmd = msg.get('cmd')
            if cmd == 'clip':
                process_clip(msg)
            elif cmd == 'source-tags':
                process_source_tags(msg)
            elif cmd == 'ping':
                send_message({'cmd': 'pong'})
            else:
                send_message({
                    'cmd': 'clip-error',
                    'clipId': msg.get('clipId'),
                    'error': f'unknown cmd: {cmd!r}',
                })
        except Exception as e:
            # Route errors to the right channel so the caller sees them under
            # the response type they expect (otherwise the background side
            # silently drops the message).
            cmd = msg.get('cmd') if isinstance(msg, dict) else None
            err_cmd = 'source-tags-error' if cmd == 'source-tags' else 'clip-error'
            payload = {
                'cmd': err_cmd,
                'error': f'{type(e).__name__}: {e}',
                'trace': traceback.format_exc(),
            }
            if err_cmd == 'clip-error':
                payload['clipId'] = msg.get('clipId') if isinstance(msg, dict) else None
            else:
                payload['videoId'] = msg.get('videoId') if isinstance(msg, dict) else None
            send_message(payload)


if __name__ == '__main__':
    main()
