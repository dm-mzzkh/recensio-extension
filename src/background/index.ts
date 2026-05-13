import {
  addClip,
  addScreenshot,
  getVideo,
  saveVideo,
  setSystemTags,
  updateClip,
} from '../db';
import { fetchVideoMetadata } from '../lib/oembed';
import type { VideoSource } from '../lib/oembed';

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

interface OpenEditorTabMessage {
  type: 'recensio:open-editor-tab';
  url: string;
}

function isOpenEditorTabMessage(m: unknown): m is OpenEditorTabMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as { type?: unknown }).type === 'recensio:open-editor-tab' &&
    typeof (m as { url?: unknown }).url === 'string'
  );
}

async function handleOpenEditorTab(msg: OpenEditorTabMessage) {
  try {
    // Only accept moz-extension:// URLs we ourselves produced — never let a
    // content script trick the background into opening an arbitrary URL.
    const expectedPrefix = browser.runtime.getURL('editor/index.html');
    if (!msg.url.startsWith(expectedPrefix)) {
      return { ok: false, error: 'unexpected url' };
    }
    await browser.tabs.create({ url: msg.url });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
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

function parseHostMsg(raw: unknown, expectedClipId: number): HostMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<HostMsg> & { cmd?: unknown; clipId?: unknown };
  if (typeof m.cmd !== 'string') return null;
  // clip-progress/chunk/done must reference the clip we requested. Ignore
  // strays (e.g. a host that confused state between requests).
  if (m.cmd === 'clip-progress' || m.cmd === 'clip-chunk' || m.cmd === 'clip-done') {
    if (m.clipId !== expectedClipId) return null;
  }
  // clip-error may carry clipId === null when the host failed before
  // parsing the request — still surface it to the caller.
  if (m.cmd === 'clip-progress') return m as HostProgressMsg;
  if (m.cmd === 'clip-chunk') {
    if (typeof (m as HostChunkMsg).index !== 'number') return null;
    if (typeof (m as HostChunkMsg).total !== 'number') return null;
    if (typeof (m as HostChunkMsg).b64 !== 'string') return null;
    return m as HostChunkMsg;
  }
  if (m.cmd === 'clip-done') return m as HostDoneMsg;
  if (m.cmd === 'clip-error') return m as HostErrorMsg;
  return null;
}

const HOST_TIMEOUT_MS = 5 * 60 * 1000;

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
    const seenChunks = new Set<number>();
    let expectedTotal = -1;
    let settled = false;

    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      try {
        port.disconnect();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      const error = `native host timeout (${HOST_TIMEOUT_MS / 60000}min)`;
      updateClip(msg.clipId, {
        status: 'error',
        errorMsg: error,
        stage: undefined,
      }).catch(() => undefined);
      finish({ ok: false, error });
    }, HOST_TIMEOUT_MS);

    port.onMessage.addListener(async (raw: unknown) => {
      const m = parseHostMsg(raw, msg.clipId);
      if (!m) return;
      try {
        if (m.cmd === 'clip-progress') {
          console.log('[Recensio host]', m.clipId, m.stage);
          await updateClip(msg.clipId, { stage: m.stage }).catch(() => undefined);
        } else if (m.cmd === 'clip-chunk') {
          chunks[m.index] = base64ToBytes(m.b64);
          seenChunks.add(m.index);
          expectedTotal = m.total;
          const received = seenChunks.size;
          if (received === 1 || received % 5 === 0 || received === m.total) {
            await updateClip(msg.clipId, {
              stage: `chunks ${received}/${m.total}`,
            }).catch(() => undefined);
          }
        } else if (m.cmd === 'clip-done') {
          if (expectedTotal === -1) expectedTotal = 0;
          const missing: number[] = [];
          for (let i = 0; i < expectedTotal; i++) {
            if (!seenChunks.has(i)) missing.push(i);
          }
          if (missing.length > 0) {
            const preview = missing.slice(0, 10).join(', ');
            const more = missing.length > 10 ? `, …(+${missing.length - 10})` : '';
            const error = `missing chunks: ${preview}${more} (got ${seenChunks.size} of ${expectedTotal})`;
            await updateClip(msg.clipId, { status: 'error', errorMsg: error, stage: undefined });
            finish({ ok: false, error });
            return;
          }
          const totalSize = chunks.reduce((s, c) => s + (c?.length ?? 0), 0);
          const merged = new Uint8Array(totalSize);
          let off = 0;
          for (let i = 0; i < expectedTotal; i++) {
            const c = chunks[i];
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
          const errorMsg = m.trace ? `${m.error}\n\n${m.trace}` : m.error;
          await updateClip(msg.clipId, {
            status: 'error',
            errorMsg,
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

interface FetchSourceTagsMessage {
  type: 'recensio:fetch-source-tags';
  videoId: string;
  url: string;
  source: VideoSource;
}

function isFetchSourceTagsMessage(m: unknown): m is FetchSourceTagsMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as { type?: unknown }).type === 'recensio:fetch-source-tags' &&
    typeof (m as { videoId?: unknown }).videoId === 'string' &&
    typeof (m as { url?: unknown }).url === 'string'
  );
}

const SOURCE_TAGS_TIMEOUT_MS = 45 * 1000;

async function fetchSourceTagsViaHost(
  msg: FetchSourceTagsMessage,
): Promise<{ ok: boolean; tags?: string[]; error?: string }> {
  let port: browser.runtime.Port;
  try {
    port = browser.runtime.connectNative(NATIVE_HOST);
  } catch (e) {
    return { ok: false, error: `native host ${NATIVE_HOST} unreachable: ${(e as Error).message}` };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: boolean; tags?: string[]; error?: string }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      try {
        port.disconnect();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const timeoutId = window.setTimeout(() => {
      finish({ ok: false, error: `source-tags timeout (${SOURCE_TAGS_TIMEOUT_MS / 1000}s)` });
    }, SOURCE_TAGS_TIMEOUT_MS);

    port.onMessage.addListener((raw: unknown) => {
      if (!raw || typeof raw !== 'object') return;
      const m = raw as { cmd?: string; videoId?: string; tags?: unknown; error?: string };
      // Cross-check videoId so we don't accept a stray response from another
      // in-flight request that happened to share this port.
      if (m.videoId !== msg.videoId) return;
      if (m.cmd === 'source-tags-done') {
        const tags = Array.isArray(m.tags)
          ? m.tags.filter((t): t is string => typeof t === 'string')
          : [];
        finish({ ok: true, tags });
      } else if (m.cmd === 'source-tags-error') {
        finish({ ok: false, error: m.error || 'unknown error' });
      }
    });

    port.onDisconnect.addListener((p) => {
      const err = (p as browser.runtime.Port & { error?: { message?: string } }).error;
      finish({ ok: false, error: err?.message ?? 'native host disconnected' });
    });

    try {
      port.postMessage({
        cmd: 'source-tags',
        videoId: msg.videoId,
        url: msg.url,
        source: msg.source,
      });
    } catch (e) {
      finish({ ok: false, error: (e as Error).message });
    }
  });
}

async function handleFetchSourceTags(msg: FetchSourceTagsMessage) {
  const result = await fetchSourceTagsViaHost(msg);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  try {
    await setSystemTags(msg.videoId, result.tags ?? []);
  } catch (e) {
    return { ok: false, error: `db: ${(e as Error).message}` };
  }
  return { ok: true, tags: result.tags ?? [] };
}

browser.runtime.onMessage.addListener((msg) => {
  if (isSaveMessage(msg)) return handleSave(msg);
  if (isSaveClipMessage(msg)) return handleSaveClip(msg);
  if (isStartRecordingMessage(msg)) return handleStartRecording(msg);
  if (isOpenEditorTabMessage(msg)) return handleOpenEditorTab(msg);
  if (isFetchSourceTagsMessage(msg)) return handleFetchSourceTags(msg);
  return undefined;
});
