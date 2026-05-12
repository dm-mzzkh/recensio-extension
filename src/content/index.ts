import { extractVideoId } from '../lib/oembed';

const BTN_ID = 'recensio-title-btn';
const SHOT_BTN_ID = 'recensio-shot-btn';
const OVERLAY_ID = 'recensio-overlay';
const TOAST_ID = 'recensio-toast';

function injectStyles() {
  if (document.getElementById('recensio-styles')) return;
  const style = document.createElement('style');
  style.id = 'recensio-styles';
  style.textContent = `
    .recensio-action {
      margin-left: 8px;
      align-self: center;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(99, 102, 241, 0.15);
      color: var(--yt-spec-text-primary, #f8fafc);
      border: 1px solid rgba(99, 102, 241, 0.7);
      border-radius: 18px;
      padding: 6px 12px;
      font: 600 13px "Roboto", system-ui, sans-serif;
      cursor: pointer;
      transition: background 0.15s;
      vertical-align: middle;
    }
    .recensio-action:hover { background: rgba(99, 102, 241, 0.95); color: #fff; }
    .recensio-action:disabled { opacity: 0.5; cursor: not-allowed; }
    #${BTN_ID} { margin-left: 12px; }
    #${OVERLAY_ID} {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #${OVERLAY_ID} .recensio-frame-wrap {
      position: relative;
      width: min(560px, 92vw);
      height: min(720px, 88vh);
      background: #1e293b;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    }
    #${OVERLAY_ID} iframe { width: 100%; height: 100%; border: 0; background: #1e293b; }
    #${OVERLAY_ID} .recensio-close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 28px;
      height: 28px;
      border-radius: 14px;
      border: 0;
      background: rgba(15, 23, 42, 0.85);
      color: #f8fafc;
      font-size: 16px;
      cursor: pointer;
      z-index: 1;
    }
    #${OVERLAY_ID} .recensio-close:hover { background: #b91c1c; }
    #${TOAST_ID} {
      position: fixed;
      left: 50%;
      bottom: 80px;
      transform: translateX(-50%);
      z-index: 2147483647;
      padding: 8px 14px;
      border-radius: 6px;
      background: rgba(15, 23, 42, 0.95);
      color: #f8fafc;
      font: 600 13px system-ui, sans-serif;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      opacity: 0;
      transition: opacity 0.2s;
      pointer-events: none;
    }
    #${TOAST_ID}.recensio-toast--show { opacity: 1; }
    #${TOAST_ID}.recensio-toast--error { background: #b91c1c; }
  `;
  document.head.appendChild(style);
}

function findVideoEl(): HTMLVideoElement | null {
  // Match the actively playing element. YouTube can have multiple <video> tags
  // (e.g. shorts/preview); `[src]` filters to the one with a real MSE blob URL.
  return (
    document.querySelector<HTMLVideoElement>('video[src]') ??
    document.querySelector<HTMLVideoElement>('#movie_player video')
  );
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

let toastTimer: number | undefined;
function showToast(text: string, error = false) {
  let el = document.getElementById(TOAST_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = TOAST_ID;
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.toggle('recensio-toast--error', error);
  void el.offsetWidth;
  el.classList.add('recensio-toast--show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el?.classList.remove('recensio-toast--show');
  }, 1800);
}

function renderVideoFrame(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      'image/jpeg',
      0.92,
    );
  });
}

function waitNextVideoFrame(video: HTMLVideoElement): Promise<void> {
  const rvfc = (video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
  }).requestVideoFrameCallback;
  if (typeof rvfc !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      resolve();
    };
    rvfc.call(video, settle);
    window.setTimeout(settle, 500);
  });
}

async function takeScreenshot() {
  const video = findVideoEl();
  if (!video) {
    showToast('Видео не найдено', true);
    return;
  }
  const videoId = extractVideoId(location.href);
  if (!videoId) {
    showToast('Не страница видео', true);
    return;
  }
  if (video.mediaKeys != null) {
    showToast('Видео защищено DRM — снимок невозможен', true);
    return;
  }
  if (!video.videoWidth || !video.videoHeight) {
    showToast('Видео ещё не загружено', true);
    return;
  }
  const timeSec = video.currentTime;
  try {
    if (!video.paused) await waitNextVideoFrame(video);
    const blob = await renderVideoFrame(video);
    const buffer = await blob.arrayBuffer();
    const resp = (await browser.runtime.sendMessage({
      type: 'recensio:save-screenshot',
      videoId,
      url: location.href,
      timeSec,
      width: video.videoWidth,
      height: video.videoHeight,
      blobType: blob.type,
      buffer,
    })) as { ok: boolean; error?: string } | undefined;
    if (resp?.ok) {
      showToast(`📷 ${fmtTime(timeSec)} сохранён`);
    } else {
      showToast(`Ошибка: ${resp?.error ?? 'unknown'}`, true);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (/tainted|insecure|security/i.test(msg)) {
      showToast('Видео защищено DRM — снимок невозможен', true);
    } else {
      showToast(`Ошибка: ${msg}`, true);
    }
  }
}

function ensureButton() {
  if (document.getElementById(BTN_ID) && document.getElementById(SHOT_BTN_ID)) return;
  const title = document.querySelector('h1.ytd-watch-metadata');
  if (!title) return;

  if (!document.getElementById(BTN_ID)) {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.className = 'recensio-action';
    btn.type = 'button';
    btn.title = 'Edit in Recensio';
    btn.textContent = '★ Recensio';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openOverlay();
    });
    title.appendChild(btn);
  }

  if (!document.getElementById(SHOT_BTN_ID)) {
    const shot = document.createElement('button');
    shot.id = SHOT_BTN_ID;
    shot.className = 'recensio-action';
    shot.type = 'button';
    shot.title = 'Снять скриншот текущего кадра (Alt+Shift+S)';
    shot.textContent = '📷';
    shot.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      void takeScreenshot();
    });
    title.appendChild(shot);
  }
}

function closeOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}

function openOverlay() {
  closeOverlay();
  const videoId = extractVideoId(location.href);
  if (!videoId) return;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay();
  });

  const wrap = document.createElement('div');
  wrap.className = 'recensio-frame-wrap';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'recensio-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', closeOverlay);
  wrap.appendChild(closeBtn);

  const iframe = document.createElement('iframe');
  const url = browser.runtime.getURL('editor/index.html');
  iframe.src = `${url}?id=${encodeURIComponent(videoId)}&url=${encodeURIComponent(location.href)}`;
  wrap.appendChild(iframe);

  overlay.appendChild(wrap);
  document.body.appendChild(overlay);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById(OVERLAY_ID)) {
    closeOverlay();
  }
});

browser.runtime.onMessage.addListener((msg) => {
  if (
    msg &&
    typeof msg === 'object' &&
    (msg as { type?: string }).type === 'recensio:trigger-capture'
  ) {
    void takeScreenshot();
  }
  return undefined;
});

window.addEventListener('message', (e) => {
  const data = e.data;
  if (data && typeof data === 'object' && data.source === 'recensio' && data.type === 'close') {
    closeOverlay();
  }
});

console.log('[Recensio] content script loaded on', location.href);
injectStyles();
ensureButton();

let ensureScheduled = false;
function scheduleEnsureButton() {
  if (ensureScheduled) return;
  ensureScheduled = true;
  window.setTimeout(() => {
    ensureScheduled = false;
    ensureButton();
  }, 150);
}

const observer = new MutationObserver(() => scheduleEnsureButton());
observer.observe(document.body, { childList: true, subtree: true });

document.addEventListener('yt-navigate-finish', () => {
  closeOverlay();
  ensureButton();
});
