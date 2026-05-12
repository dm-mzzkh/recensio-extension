import { addScreenshot, getVideo, saveVideo } from '../db';
import { fetchVideoMetadata } from '../lib/oembed';

browser.runtime.onInstalled.addListener(() => {
  console.log('Recensio installed');
});

browser.commands.onCommand.addListener(async (name) => {
  if (name !== 'take-screenshot') return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await browser.tabs.sendMessage(tab.id, { type: 'recensio:trigger-capture' });
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

browser.runtime.onMessage.addListener(async (msg) => {
  if (!isSaveMessage(msg)) return;
  try {
    if (!(await getVideo(msg.videoId))) {
      const meta = await fetchVideoMetadata(msg.url);
      if (meta) await saveVideo(meta);
    }
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
});
