import { extractVideoId } from '../lib/oembed';

const BTN_ID = 'recensio-title-btn';
const SHOT_BTN_ID = 'recensio-shot-btn';
const CLIP_BTN_ID = 'recensio-clip-btn';
const CLIP_PANEL_ID = 'recensio-clip-panel';
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
    .recensio-action.recensio-action--pending {
      background: rgba(251, 191, 36, 0.25);
      border-color: #f59e0b;
      color: #fbbf24;
    }
    .recensio-action.recensio-action--pending:hover {
      background: rgba(251, 191, 36, 0.85);
      color: #1f2937;
    }
    .recensio-action.recensio-action--ready {
      background: rgba(16, 185, 129, 0.25);
      border-color: #10b981;
      color: #6ee7b7;
    }
    #recensio-clip-panel {
      display: none;
      margin-top: 8px;
      padding: 10px 12px;
      background: rgba(15, 23, 42, 0.96);
      border: 1px solid #334155;
      border-radius: 8px;
      color: #f8fafc;
      font: 500 13px system-ui, sans-serif;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    #recensio-clip-panel.recensio-clip-panel--visible { display: flex; }
    #recensio-clip-panel .recensio-clip-panel__range {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: #fbbf24;
    }
    #recensio-clip-panel .recensio-clip-panel__hint {
      color: #94a3b8;
      font-weight: 400;
    }
    #recensio-clip-panel button {
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid transparent;
      cursor: pointer;
      font: 600 12px system-ui, sans-serif;
    }
    #recensio-clip-panel .recensio-clip-panel__save {
      background: #10b981; color: #052e1c; border-color: #059669;
    }
    #recensio-clip-panel .recensio-clip-panel__save:hover { background: #34d399; }
    #recensio-clip-panel .recensio-clip-panel__save:disabled { opacity: 0.5; cursor: not-allowed; }
    #recensio-clip-panel .recensio-clip-panel__cancel {
      background: transparent; color: #cbd5e1; border-color: #475569;
    }
    #recensio-clip-panel .recensio-clip-panel__cancel:hover {
      background: #b91c1c; color: #fff; border-color: #b91c1c;
    }
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

interface PendingClip {
  videoId: string;
  startSec: number;
  endSec?: number;
}
let pendingClip: PendingClip | null = null;

function fmtYtDlpTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec - h * 3600 - m * 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${s.toFixed(2).padStart(5, '0')}`;
}

function ytDlpCommand(videoId: string, startSec: number, endSec: number): string {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const range = `*${fmtYtDlpTime(startSec)}-${fmtYtDlpTime(endSec)}`;
  return `yt-dlp -f "bv*+ba/b" --download-sections "${range}" "${url}"`;
}

function updateClipButton() {
  const btn = document.getElementById(CLIP_BTN_ID);
  if (!btn) return;
  btn.classList.remove('recensio-action--pending', 'recensio-action--ready');
  if (!pendingClip) {
    btn.textContent = '✂';
    btn.title = 'Поставить метку клипа (Alt+Shift+C). Первый клик — начало, второй — конец.';
    return;
  }
  if (pendingClip.endSec == null) {
    btn.classList.add('recensio-action--pending');
    btn.textContent = `✂ ${fmtTime(pendingClip.startSec)} → …`;
    btn.title = 'Нажмите ещё раз, чтобы поставить метку конца клипа';
  } else {
    btn.classList.add('recensio-action--ready');
    btn.textContent = `✂ ${fmtTime(pendingClip.startSec)} – ${fmtTime(pendingClip.endSec)}`;
    btn.title = 'Метки готовы — выберите «Сохранить» или «Отменить»';
  }
}

function renderPanel() {
  const panel = document.getElementById(CLIP_PANEL_ID);
  if (!panel) return;
  panel.classList.toggle('recensio-clip-panel--visible', pendingClip != null);
  panel.innerHTML = '';
  if (!pendingClip) return;

  const range = document.createElement('span');
  range.className = 'recensio-clip-panel__range';
  if (pendingClip.endSec == null) {
    range.textContent = `▶ ${fmtTime(pendingClip.startSec)} → …`;
  } else {
    const dur = pendingClip.endSec - pendingClip.startSec;
    range.textContent = `▶ ${fmtTime(pendingClip.startSec)} – ${fmtTime(
      pendingClip.endSec,
    )} (${dur.toFixed(1)} c)`;
  }
  panel.appendChild(range);

  if (pendingClip.endSec != null) {
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'recensio-clip-panel__save';
    save.textContent = '↓ Сохранить';
    save.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      void savePendingClip();
    });
    panel.appendChild(save);
  }

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'recensio-clip-panel__cancel';
  cancel.textContent = '✕ Отменить';
  cancel.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    cancelPendingClip();
  });
  panel.appendChild(cancel);
}

function resetClip() {
  pendingClip = null;
  updateClipButton();
  renderPanel();
}

function cancelPendingClip() {
  if (!pendingClip) return;
  resetClip();
  showToast('Клип отменён');
}

async function savePendingClip() {
  if (!pendingClip || pendingClip.endSec == null) return;
  const { videoId, startSec, endSec } = pendingClip as Required<PendingClip>;
  try {
    const resp = (await browser.runtime.sendMessage({
      type: 'recensio:save-clip',
      videoId,
      url: location.href,
      startSec,
      endSec,
    })) as { ok: boolean; id?: number; error?: string } | undefined;
    if (!resp?.ok || resp.id == null) {
      showToast(`Ошибка: ${resp?.error ?? 'unknown'}`, true);
      return;
    }
    const clipId = resp.id;
    const cmd = ytDlpCommand(videoId, startSec, endSec);
    let copied = false;
    try {
      await navigator.clipboard.writeText(cmd);
      copied = true;
    } catch {
      copied = false;
    }
    const dur = endSec - startSec;
    showToast(
      `✂ ${fmtTime(startSec)}–${fmtTime(endSec)} (${dur.toFixed(1)} c)${
        copied ? ' · yt-dlp скопирован' : ''
      } · идёт фоновая запись…`,
      false,
    );
    resetClip();
    // Kick off background recording. Don't await — user shouldn't block.
    void browser.runtime.sendMessage({
      type: 'recensio:start-recording',
      clipId,
      videoId,
      startSec,
      endSec,
    });
  } catch (e) {
    showToast(`Ошибка: ${(e as Error).message}`, true);
  }
}

async function toggleClipMark() {
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
  const t = video.currentTime;
  if (!Number.isFinite(t)) {
    showToast('Время видео недоступно', true);
    return;
  }

  // No pending (or different video) → set first marker
  if (!pendingClip || pendingClip.videoId !== videoId) {
    pendingClip = { videoId, startSec: t };
    updateClipButton();
    renderPanel();
    showToast(`✂ Метка начала: ${fmtTime(t)}`);
    return;
  }

  // First marker present, no end → set second marker
  if (pendingClip.endSec == null) {
    if (t <= pendingClip.startSec) {
      showToast(`Конец должен быть позже ${fmtTime(pendingClip.startSec)}`, true);
      return;
    }
    pendingClip = { ...pendingClip, endSec: t };
    updateClipButton();
    renderPanel();
    showToast(
      `✂ Метка конца: ${fmtTime(t)} · нажмите «Сохранить» в панели ниже`,
    );
    return;
  }

  // Both markers already set → re-position end marker (lets user retake without cancelling)
  if (t > pendingClip.startSec) {
    pendingClip = { ...pendingClip, endSec: t };
    updateClipButton();
    renderPanel();
    showToast(`Метка конца обновлена: ${fmtTime(t)}`);
  }
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
  if (
    document.getElementById(BTN_ID) &&
    document.getElementById(SHOT_BTN_ID) &&
    document.getElementById(CLIP_BTN_ID) &&
    document.getElementById(CLIP_PANEL_ID)
  ) {
    return;
  }
  const title = document.querySelector<HTMLElement>('h1.ytd-watch-metadata');
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

  if (!document.getElementById(CLIP_BTN_ID)) {
    const clip = document.createElement('button');
    clip.id = CLIP_BTN_ID;
    clip.className = 'recensio-action';
    clip.type = 'button';
    clip.textContent = '✂';
    clip.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      void toggleClipMark();
    });
    title.appendChild(clip);
  }

  if (!document.getElementById(CLIP_PANEL_ID)) {
    const panel = document.createElement('div');
    panel.id = CLIP_PANEL_ID;
    // Place panel right after the title so it sits under the action buttons.
    if (title.parentElement) {
      title.parentElement.insertBefore(panel, title.nextSibling);
    } else {
      title.appendChild(panel);
    }
  }

  updateClipButton();
  renderPanel();
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
  if (e.key === 'Escape') {
    if (document.getElementById(OVERLAY_ID)) {
      closeOverlay();
    } else if (pendingClip) {
      cancelPendingClip();
    }
  }
});

browser.runtime.onMessage.addListener((msg) => {
  const type = msg && typeof msg === 'object' ? (msg as { type?: string }).type : undefined;
  if (type === 'recensio:trigger-capture') void takeScreenshot();
  else if (type === 'recensio:trigger-clip-mark') void toggleClipMark();
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

// Narrow scope: observe the page-level container with childList only.
// document.body + subtree fires on every comment/recommendation update,
// which is hundreds of useless callbacks per minute. The page-manager
// swap on SPA navigation is the only mutation we actually care about.
const observer = new MutationObserver(() => scheduleEnsureButton());
const observerTarget =
  document.querySelector('ytd-page-manager') ?? document.body;
observer.observe(observerTarget, { childList: true });

document.addEventListener('yt-navigate-finish', () => {
  closeOverlay();
  pendingClip = null;
  window.clearTimeout(toastTimer);
  ensureButton();
});

window.addEventListener('pagehide', () => {
  observer.disconnect();
  window.clearTimeout(toastTimer);
});
