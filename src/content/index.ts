import { extractVideoId } from '../lib/oembed';

const BTN_ID = 'recensio-title-btn';
const OVERLAY_ID = 'recensio-overlay';

function injectStyles() {
  if (document.getElementById('recensio-styles')) return;
  const style = document.createElement('style');
  style.id = 'recensio-styles';
  style.textContent = `
    #${BTN_ID} {
      margin-left: 12px;
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
    #${BTN_ID}:hover {
      background: rgba(99, 102, 241, 0.95);
      color: #fff;
    }
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
    #${OVERLAY_ID} iframe {
      width: 100%;
      height: 100%;
      border: 0;
      background: #1e293b;
    }
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
    #${OVERLAY_ID} .recensio-close:hover {
      background: #b91c1c;
    }
  `;
  document.head.appendChild(style);
}

function ensureButton() {
  if (document.getElementById(BTN_ID)) return;
  const title = document.querySelector('h1.ytd-watch-metadata');
  if (!title) return;

  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.type = 'button';
  btn.title = 'Edit in Recensio';
  btn.textContent = '★ Recensio';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    openOverlay();
  });
  title.appendChild(btn);
  console.log('[Recensio] button injected next to', title);
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

window.addEventListener('message', (e) => {
  const data = e.data;
  if (data && typeof data === 'object' && data.source === 'recensio' && data.type === 'close') {
    closeOverlay();
  }
});

console.log('[Recensio] content script loaded on', location.href);
injectStyles();
ensureButton();

const observer = new MutationObserver(() => ensureButton());
observer.observe(document.body, { childList: true, subtree: true });

document.addEventListener('yt-navigate-finish', () => {
  closeOverlay();
  ensureButton();
});
