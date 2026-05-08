import { renderEditor } from '../lib/editor';
import { getVideo, saveVideo } from '../db';
import { fetchVideoMetadata } from '../lib/oembed';

const root = document.getElementById('root')!;

function notifyParent(type: string) {
  if (window.parent !== window) {
    window.parent.postMessage({ source: 'recensio', type }, '*');
  }
}

async function init() {
  const params = new URL(location.href).searchParams;
  const videoId = params.get('id');
  const watchUrl = params.get('url') ?? (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);

  if (!videoId || !watchUrl) {
    root.innerHTML = '<p class="empty">No video id provided</p>';
    return;
  }

  let video = await getVideo(videoId);
  if (!video) {
    root.innerHTML = '<p class="status">Loading metadata…</p>';
    try {
      const meta = await fetchVideoMetadata(watchUrl);
      if (!meta) {
        root.innerHTML = '<p class="empty">Could not load video metadata</p>';
        return;
      }
      await saveVideo(meta);
      video = await getVideo(videoId);
    } catch (e) {
      root.replaceChildren();
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = `Failed to load: ${(e as Error).message}`;
      root.appendChild(p);
      return;
    }
  }
  if (!video) {
    root.innerHTML = '<p class="empty">Not found</p>';
    return;
  }

  await renderEditor(root, videoId, {
    onDeleted: () => notifyParent('close'),
  });
}

void init();
