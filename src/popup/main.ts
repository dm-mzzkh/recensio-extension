import {
  saveVideo,
  getVideo,
  setVideoTags,
  getVideoTags,
  listTags,
  normalizeTag,
} from '../db';
import { extractVideoRef, fetchVideoMetadata, type VideoMetadata } from '../lib/oembed';

const titleEl = document.getElementById('title')!;
const statusEl = document.getElementById('status')!;
const tagsEl = document.getElementById('tags')!;
const tagInput = document.getElementById('tag-input') as HTMLInputElement;
const tagList = document.getElementById('tag-list') as HTMLDataListElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const libraryBtn = document.getElementById('library') as HTMLButtonElement;

let currentVideoId: string | null = null;
let currentMeta:
  | (Pick<VideoMetadata, 'title' | 'channel' | 'thumbnail' | 'source'> & { url?: string })
  | null = null;
let pendingTags: string[] = [];

function renderTags() {
  tagsEl.innerHTML = '';
  for (const tag of pendingTags) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `#${tag}`;
    const x = document.createElement('button');
    x.className = 'chip-remove';
    x.textContent = '×';
    x.addEventListener('click', () => {
      pendingTags = pendingTags.filter((t) => t !== tag);
      renderTags();
    });
    chip.appendChild(x);
    tagsEl.appendChild(chip);
  }
}

function addTag(raw: string) {
  const norm = normalizeTag(raw);
  if (!norm || pendingTags.includes(norm)) return;
  pendingTags.push(norm);
  renderTags();
}

tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag(tagInput.value);
    tagInput.value = '';
  } else if (e.key === 'Backspace' && tagInput.value === '' && pendingTags.length) {
    pendingTags.pop();
    renderTags();
  }
});

async function refreshTagSuggestions() {
  const all = await listTags();
  tagList.innerHTML = '';
  for (const t of all) {
    const opt = document.createElement('option');
    opt.value = t.name;
    tagList.appendChild(opt);
  }
}

saveBtn.addEventListener('click', async () => {
  if (!currentVideoId || !currentMeta) return;
  if (tagInput.value.trim()) {
    addTag(tagInput.value);
    tagInput.value = '';
  }
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  try {
    await saveVideo({ videoId: currentVideoId, ...currentMeta });
    await setVideoTags(currentVideoId, pendingTags);
    saveBtn.textContent = 'Saved ✓';
    await refreshTagSuggestions();
    setTimeout(() => {
      saveBtn.textContent = 'Update';
      saveBtn.disabled = false;
    }, 800);
  } catch (e) {
    console.error(e);
    statusEl.textContent = `Error: ${(e as Error).message}`;
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
});

libraryBtn.addEventListener('click', () => {
  browser.tabs.create({ url: browser.runtime.getURL('library/index.html') });
  window.close();
});

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    statusEl.textContent = 'No active tab';
    saveBtn.disabled = true;
    return;
  }
  const ref = extractVideoRef(tab.url);
  if (!ref) {
    titleEl.textContent = '—';
    statusEl.textContent = 'Not a YouTube or TikTok video page';
    saveBtn.disabled = true;
    tagInput.disabled = true;
    return;
  }
  const { videoId, source } = ref;
  currentVideoId = videoId;
  await refreshTagSuggestions();

  const existing = await getVideo(videoId);
  if (existing) {
    currentMeta = {
      title: existing.title,
      channel: existing.channel,
      thumbnail: existing.thumbnail,
      source: existing.source,
      url: existing.url,
    };
    titleEl.textContent = existing.title;
    statusEl.textContent = `Already saved · ${existing.channel}`;
    saveBtn.textContent = 'Update';
    const existingTags = await getVideoTags(videoId);
    pendingTags = existingTags.map((t) => t.name);
    renderTags();
    return;
  }

  const rawTitle = tab.title ?? '';
  titleEl.textContent =
    (source === 'tiktok' ? rawTitle.replace(/ \| TikTok$/, '') : rawTitle.replace(/ - YouTube$/, '')) ||
    '…';
  statusEl.textContent = 'Loading metadata…';
  try {
    const meta = await fetchVideoMetadata(tab.url);
    if (!meta) {
      statusEl.textContent = 'Could not extract video';
      saveBtn.disabled = true;
      return;
    }
    currentMeta = meta;
    titleEl.textContent = meta.title;
    statusEl.textContent = meta.channel;
  } catch (e) {
    console.error(e);
    statusEl.textContent = `Failed to load: ${(e as Error).message}`;
    saveBtn.disabled = true;
  }
}

init();
