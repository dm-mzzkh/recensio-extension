import { addClip, addScreenshot, getVideo, saveVideo, updateClip } from '../db';
import { fetchVideoMetadata } from '../lib/oembed';

browser.runtime.onInstalled.addListener(() => {
  console.log('Recensio installed');
});

const COMMAND_TO_MSG: Record<string, string> = {
  'take-screenshot': 'recensio:trigger-capture',
  'take-clip-mark': 'recensio:trigger-clip-mark',
};

browser.commands.onCommand.addListener(async (name) => {
  const msgType = COMMAND_TO_MSG[name];
  if (!msgType) return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await browser.tabs.sendMessage(tab.id, { type: msgType });
  } catch (e) {
    console.error('[Recensio] command dispatch failed', e);
  }
});

interface SaveScreenshotMessage {
  type: 'recensio:save-screenshot';
  videoId: string;
  url: string;
  timeSec: number;
  width: number;
  height: number;
  blobType: string;
  buffer: ArrayBuffer;
}

function isSaveMessage(m: unknown): m is SaveScreenshotMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as { type?: unknown }).type === 'recensio:save-screenshot'
  );
}

interface SaveClipMessage {
  type: 'recensio:save-clip';
  videoId: string;
  url: string;
  startSec: number;
  endSec: number;
  title?: string;
  note?: string;
  buffer?: ArrayBuffer;
  mimeType?: string;
  width?: number;
  height?: number;
}

function isSaveClipMessage(m: unknown): m is SaveClipMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as { type?: unknown }).type === 'recensio:save-clip'
  );
}

async function ensureVideoSaved(videoId: string, url: string) {
  if (await getVideo(videoId)) return;
  const meta = await fetchVideoMetadata(url);
  if (meta) await saveVideo(meta);
}

async function handleSaveClip(msg: SaveClipMessage) {
  try {
    await ensureVideoSaved(msg.videoId, msg.url);
    const blob =
      msg.buffer && msg.buffer.byteLength > 0
        ? new Blob([msg.buffer], { type: msg.mimeType || 'video/webm' })
        : undefined;
    const id = await addClip({
      videoId: msg.videoId,
      startSec: msg.startSec,
      endSec: msg.endSec,
      title: msg.title,
      note: msg.note,
      blob,
      mimeType: blob ? msg.mimeType : undefined,
      width: msg.width,
      height: msg.height,
    });
    return { ok: true, id };
  } catch (e) {
    console.error('[Recensio] save clip failed', e);
    return { ok: false, error: (e as Error).message };
  }
}

async function handleSave(msg: SaveScreenshotMessage) {
  try {
    await ensureVideoSaved(msg.videoId, msg.url);
    const blob = new Blob([msg.buffer], { type: msg.blobType || 'image/jpeg' });
    const id = await addScreenshot({
      videoId: msg.videoId,
      blob,
      width: msg.width,
      height: msg.height,
      timeSec: msg.timeSec,
    });
    return { ok: true, id };
  } catch (e) {
    console.error('[Recensio] save screenshot failed', e);
    return { ok: false, error: (e as Error).message };
  }
}

interface StartRecordingMessage {
  type: 'recensio:start-recording';
  clipId: number;
  videoId: string;
  startSec: number;
  endSec: number;
}

function isStartRecordingMessage(m: unknown): m is StartRecordingMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as { type?: unknown }).type === 'recensio:start-recording'
  );
}

const NATIVE_HOST = 'com.recensio.ytdl';

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

interface HostChunkMsg {
  cmd: 'clip-chunk';
  clipId: number;
  index: number;
  total: number;
  b64: string;
}
interface HostDoneMsg {
  cmd: 'clip-done';
  clipId: number;
  size: number;
  mimeType?: string;
}
interface HostErrorMsg {
  cmd: 'clip-error';
  clipId: number | null;
  error: string;
  trace?: string;
}
interface HostProgressMsg {
  cmd: 'clip-progress';
  clipId: number;
  stage: string;
}
type HostMsg = HostChunkMsg | HostDoneMsg | HostErrorMsg | HostProgressMsg;

async function downloadClipViaHost(
  msg: StartRecordingMessage,
): Promise<{ ok: boolean; error?: string }> {
  await updateClip(msg.clipId, {
    status: 'pending',
    stage: 'connecting',
    errorMsg: undefined,
  });

  let port: browser.runtime.Port;
  try {
    port = browser.runtime.connectNative(NATIVE_HOST);
  } catch (e) {
    const error = `native host ${NATIVE_HOST} unreachable: ${(e as Error).message}`;
    await updateClip(msg.clipId, { status: 'error', errorMsg: error, stage: undefined });
    return { ok: false, error };
  }

  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    let expectedTotal = -1;
    let received = 0;
    let settled = false;

    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    port.onMessage.addListener(async (raw: unknown) => {
      const m = raw as HostMsg;
      if (!m || typeof m !== 'object') return;
      try {
        if (m.cmd === 'clip-progress') {
          console.log('[Recensio host]', m.clipId, m.stage);
          await updateClip(msg.clipId, { stage: m.stage }).catch(() => undefined);
        } else if (m.cmd === 'clip-chunk') {
          chunks[m.index] = base64ToBytes(m.b64);
          received++;
          expectedTotal = m.total;
          if (received === 1 || received % 5 === 0 || received === m.total) {
            await updateClip(msg.clipId, {
              stage: `chunks ${received}/${m.total}`,
            }).catch(() => undefined);
          }
        } else if (m.cmd === 'clip-done') {
          if (expectedTotal !== -1 && received !== expectedTotal) {
            const error = `chunk mismatch: received ${received} of ${expectedTotal}`;
            await updateClip(msg.clipId, { status: 'error', errorMsg: error, stage: undefined });
            finish({ ok: false, error });
            return;
          }
          const totalSize = chunks.reduce((s, c) => s + (c?.length ?? 0), 0);
          const merged = new Uint8Array(totalSize);
          let off = 0;
          for (const c of chunks) {
            if (!c) continue;
            merged.set(c, off);
            off += c.length;
          }
          const blob = new Blob([merged], { type: m.mimeType || 'video/mp4' });
          await updateClip(msg.clipId, {
            blob,
            mimeType: blob.type,
            status: 'ready',
            stage: undefined,
            errorMsg: undefined,
          });
          finish({ ok: true });
        } else if (m.cmd === 'clip-error') {
          console.warn('[Recensio host] error', m.clipId, m.error, m.trace);
          await updateClip(msg.clipId, {
            status: 'error',
            errorMsg: m.error,
            stage: undefined,
          }).catch(() => undefined);
          finish({ ok: false, error: m.error });
        }
      } catch (e) {
        finish({ ok: false, error: (e as Error).message });
      }
    });

    port.onDisconnect.addListener((p) => {
      const err = (p as browser.runtime.Port & { error?: { message?: string } }).error;
      const error = err?.message ?? 'native host disconnected';
      if (!settled) {
        updateClip(msg.clipId, {
          status: 'error',
          errorMsg: error,
          stage: undefined,
        }).catch(() => undefined);
      }
      finish({ ok: settled ? true : false, error });
    });

    try {
      port.postMessage({
        cmd: 'clip',
        clipId: msg.clipId,
        videoId: msg.videoId,
        startSec: msg.startSec,
        endSec: msg.endSec,
      });
    } catch (e) {
      finish({ ok: false, error: (e as Error).message });
    }
  });
}

async function handleStartRecording(msg: StartRecordingMessage) {
  const result = await downloadClipViaHost(msg);
  if (!result.ok) {
    console.warn('[Recensio] clip download failed', msg.clipId, result.error);
  }
  return result;
}

browser.runtime.onMessage.addListener((msg) => {
  if (isSaveMessage(msg)) return handleSave(msg);
  if (isSaveClipMessage(msg)) return handleSaveClip(msg);
  if (isStartRecordingMessage(msg)) return handleStartRecording(msg);
  return undefined;
});
