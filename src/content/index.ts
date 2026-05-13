import { extractVideoRef, type VideoSource } from '../lib/oembed';

const BTN_ID = 'recensio-title-btn';
const SHOT_BTN_ID = 'recensio-shot-btn';
const CLIP_BTN_ID = 'recensio-clip-btn';
const CLIP_PANEL_ID = 'recensio-clip-panel';
const OVERLAY_ID = 'recensio-overlay';
const TOAST_ID = 'recensio-toast';

type Layout = 'title-anchor' | 'player-overlay';

interface HostConfig {
  source: VideoSource;
  layout: Layout;
  findAnchor(): HTMLElement | null;
  observerTarget(): Element;
  observerOptions: MutationObserverInit;
  // True when 📷 / ✂ make sense for this source. TikTok is "★ Recensio only"
  // for now — clips would need a different player API, screenshots may hit
  // EME on some videos, and short looping clips don't benefit much.
  supportsCapture: boolean;
}

const YT_HOST: HostConfig = {
  source: 'youtube',
  layout: 'title-anchor',
  findAnchor: () => document.querySelector<HTMLElement>('h1.ytd-watch-metadata'),
  observerTarget: () => document.querySelector('ytd-page-manager') ?? document.body,
  // YouTube swaps direct children of <ytd-page-manager> on SPA nav — childList
  // alone is enough and avoids the comment/recommendation mutation storm.
  observerOptions: { childList: true },
  supportsCapture: true,
};

const TT_HOST: HostConfig = {
  source: 'tiktok',
  // TikTok's class names are bundle-hashed and rotate per release, so any DOM
  // anchor we picked rotted within weeks. Bypass DOM-name anchoring entirely:
  // float a single button over the <video> element's bounding rect.
  layout: 'player-overlay',
  findAnchor: () => findVideoEl(),
  observerTarget: () => document.body,
  // TikTok mounts the player UI deep inside React — childList on <body> alone
  // never fires. subtree is needed; scheduleEnsureButton() throttles to 150ms
  // so the cost is bounded even under TikTok's chatty feed re-renders.
  observerOptions: { childList: true, subtree: true },
  supportsCapture: false,
};

const HOST: HostConfig = location.hostname.endsWith('tiktok.com') ? TT_HOST : YT_HOST;

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
    .recensio-action.recensio-action--floating {
      position: fixed;
      margin-left: 0;
      z-index: 2147483646;
      background: rgba(15, 23, 42, 0.78);
      color: #f8fafc;
      border-color: rgba(99, 102, 241, 0.9);
      backdrop-filter: blur(6px);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
      font: 600 13px system-ui, sans-serif;
    }
    .recensio-action.recensio-action--floating:hover {
      background: rgba(99, 102, 241, 0.95);
      color: #fff;
    }
    .recensio-action.recensio-action--floating[hidden] { display: none; }
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
  // On TikTok the player can error out before attaching src, so we also accept
  // a bare <video> as a last resort.
  return (
    document.querySelector<HTMLVideoElement>('video[src]') ??
    document.querySelector<HTMLVideoElement>('#movie_player video') ??
    document.querySelector<HTMLVideoElement>('video')
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
  if (!HOST.supportsCapture) return;
  const video = findVideoEl();
  if (!video) {
    showToast('Видео не найдено', true);
    return;
  }
  const ref = extractVideoRef(location.href);
  if (!ref) {
    showToast('Не страница видео', true);
    return;
  }
  const { videoId } = ref;
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
  if (!HOST.supportsCapture) return;
  const video = findVideoEl();
  if (!video) {
    showToast('Видео не найдено', true);
    return;
  }
  const ref = extractVideoRef(location.href);
  if (!ref) {
    showToast('Не страница видео', true);
    return;
  }
  const { videoId } = ref;
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

let trackedVideo: HTMLVideoElement | null = null;
let videoResizeObserver: ResizeObserver | null = null;

function positionOverlayButton() {
  const btn = document.getElementById(BTN_ID) as HTMLButtonElement | null;
  if (!btn) return;
  btn.hidden = false;
  const w = btn.offsetWidth || 110;

  const video = findVideoEl();
  const r = video && video.isConnected ? video.getBoundingClientRect() : null;
  const usable =
    r &&
    r.width >= 80 &&
    r.height >= 80 &&
    r.bottom > 0 &&
    r.top < window.innerHeight &&
    r.right > 0 &&
    r.left < window.innerWidth;

  if (usable && r) {
    btn.style.top = `${Math.max(8, r.top + 12)}px`;
    btn.style.left = `${Math.max(8, r.right - w - 12)}px`;
  } else {
    // Plays-anywhere fallback: pin to viewport top-right so the button is
    // reachable even when TikTok's player errored out or hasn't mounted yet.
    btn.style.top = '16px';
    btn.style.left = `${Math.max(8, window.innerWidth - w - 16)}px`;
  }

  if (video && trackedVideo !== video) {
    trackedVideo = video;
    if (videoResizeObserver) videoResizeObserver.disconnect();
    videoResizeObserver = new ResizeObserver(() => positionOverlayButton());
    videoResizeObserver.observe(video);
  }
}

function ensurePlayerOverlayButton() {
  let btn = document.getElementById(BTN_ID) as HTMLButtonElement | null;
  if (!btn) {
    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.className = 'recensio-action recensio-action--floating';
    btn.type = 'button';
    btn.title = 'Edit in Recensio';
    btn.textContent = '★ Recensio';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openOverlay();
    });
    document.body.appendChild(btn);
  } else if (btn.parentElement !== document.body) {
    // React re-parented us. Move back to <body> so fixed positioning is sane.
    document.body.appendChild(btn);
  }
  positionOverlayButton();
}

function ensureButton() {
  if (HOST.layout === 'player-overlay') {
    ensurePlayerOverlayButton();
    return;
  }

  const needsCapture = HOST.supportsCapture;
  const fullyMounted =
    document.getElementById(BTN_ID) &&
    (!needsCapture ||
      (document.getElementById(SHOT_BTN_ID) &&
        document.getElementById(CLIP_BTN_ID) &&
        document.getElementById(CLIP_PANEL_ID)));
  if (fullyMounted) return;

  const anchor = HOST.findAnchor();
  if (!anchor) return;

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
    anchor.appendChild(btn);
  }

  if (!needsCapture) return;

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
    anchor.appendChild(shot);
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
    anchor.appendChild(clip);
  }

  if (!document.getElementById(CLIP_PANEL_ID)) {
    const panel = document.createElement('div');
    panel.id = CLIP_PANEL_ID;
    // Place panel right after the anchor so it sits under the action buttons.
    if (anchor.parentElement) {
      anchor.parentElement.insertBefore(panel, anchor.nextSibling);
    } else {
      anchor.appendChild(panel);
    }
  }

  updateClipButton();
  renderPanel();
}

function closeOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}

function buildEditorUrl(videoId: string): string {
  const base = browser.runtime.getURL('editor/index.html');
  return `${base}?id=${encodeURIComponent(videoId)}&url=${encodeURIComponent(location.href)}&source=${HOST.source}`;
}

function openOverlay() {
  closeOverlay();
  const ref = extractVideoRef(location.href);
  if (!ref) return;
  const editorUrl = buildEditorUrl(ref.videoId);

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
  iframe.src = editorUrl;

  // CSP/frame-ancestors on some hosts (TikTok in particular) can refuse to
  // render the moz-extension iframe. We can't read the cross-origin frame to
  // detect that synchronously, so we race: if the iframe hasn't loaded by the
  // deadline, assume blocked and open the editor in a new tab instead.
  let iframeLoaded = false;
  iframe.addEventListener('load', () => {
    iframeLoaded = true;
  });
  window.setTimeout(() => {
    if (!iframeLoaded && document.getElementById(OVERLAY_ID)) {
      closeOverlay();
      void browser.runtime.sendMessage({ type: 'recensio:open-editor-tab', url: editorUrl });
    }
  }, 1500);

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
let lastUrl = location.href;
function onUrlMaybeChanged() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  closeOverlay();
  pendingClip = null;
  window.clearTimeout(toastTimer);
  ensureButton();
}

const observer = new MutationObserver(() => {
  onUrlMaybeChanged();
  scheduleEnsureButton();
});
observer.observe(HOST.observerTarget(), HOST.observerOptions);

if (HOST.source === 'youtube') {
  // YouTube fires a dedicated SPA-nav event — cheaper than relying on
  // mutation-driven URL polling for that source.
  document.addEventListener('yt-navigate-finish', () => {
    lastUrl = location.href;
    closeOverlay();
    pendingClip = null;
    window.clearTimeout(toastTimer);
    ensureButton();
  });
}

if (HOST.layout === 'player-overlay') {
  // Player rect can shift on scroll, viewport resize, or fullscreen toggle.
  // Re-positioning is cheap (one getBoundingClientRect + 2 style writes).
  window.addEventListener('scroll', positionOverlayButton, { passive: true, capture: true });
  window.addEventListener('resize', positionOverlayButton);
  document.addEventListener('fullscreenchange', positionOverlayButton);
}

window.addEventListener('pagehide', () => {
  observer.disconnect();
  videoResizeObserver?.disconnect();
  window.clearTimeout(toastTimer);
});
