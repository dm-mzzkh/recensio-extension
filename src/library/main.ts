import {
  searchVideos,
  getVideoTags,
  listTags,
  normalizeTag,
  type Video,
  type Tag,
} from '../db';
import { renderEditor } from '../lib/editor';
import { exportBackup, importBackup } from '../lib/backup';

const listEl = document.getElementById('list')!;
const detailEl = document.getElementById('detail')!;
const queryInput = document.getElementById('query') as HTMLInputElement;
const tagFilterInput = document.getElementById('tag-filter-input') as HTMLInputElement;
const tagFiltersEl = document.getElementById('tag-filters')!;
const ratingMinInput = document.getElementById('rating-min') as HTMLInputElement;
const ratingMaxInput = document.getElementById('rating-max') as HTMLInputElement;
const emptyEl = document.getElementById('empty')!;
const allTagsList = document.getElementById('all-tags-list') as HTMLDataListElement;

const filters = {
  query: '',
  tagNames: [] as string[],
  ratingMin: 1,
  ratingMax: 10,
};

let selectedId: string | null = null;
let allTags: Tag[] = [];

function renderTagSuggestions() {
  allTagsList.innerHTML = '';
  for (const t of allTags) {
    const opt = document.createElement('option');
    opt.value = t.name;
    allTagsList.appendChild(opt);
  }
}

function renderTagFilters() {
  tagFiltersEl.innerHTML = '';
  for (const tag of filters.tagNames) {
    const chip = document.createElement('span');
    chip.className = 'chip chip--filter';
    chip.textContent = `#${tag}`;
    const x = document.createElement('button');
    x.className = 'chip-remove';
    x.textContent = '×';
    x.addEventListener('click', () => {
      filters.tagNames = filters.tagNames.filter((t) => t !== tag);
      renderTagFilters();
      void refresh();
    });
    chip.appendChild(x);
    tagFiltersEl.appendChild(chip);
  }
}

function renderList(videos: Video[], videoTagsMap: Map<string, Tag[]>) {
  listEl.innerHTML = '';
  emptyEl.style.display = videos.length === 0 ? 'block' : 'none';
  for (const v of videos) {
    const card = document.createElement('div');
    card.className = 'card';
    if (v.videoId === selectedId) card.classList.add('card--selected');
    card.addEventListener('click', () => {
      selectedId = v.videoId;
      for (const c of Array.from(listEl.querySelectorAll('.card'))) {
        c.classList.remove('card--selected');
      }
      card.classList.add('card--selected');
      void renderDetail();
    });

    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.src = v.thumbnail;
    thumb.alt = '';
    card.appendChild(thumb);

    const meta = document.createElement('div');
    meta.className = 'card-meta';

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = v.title;
    meta.appendChild(title);

    const channel = document.createElement('div');
    channel.className = 'card-channel';
    channel.textContent = v.channel;
    meta.appendChild(channel);

    const tags = videoTagsMap.get(v.videoId) ?? [];
    if (tags.length) {
      const row = document.createElement('div');
      row.className = 'card-tags';
      for (const t of tags) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = `#${t.name}`;
        row.appendChild(tag);
      }
      meta.appendChild(row);
    }

    if (v.rating != null) {
      const rating = document.createElement('div');
      rating.className = 'card-rating';
      rating.textContent = `★ ${v.rating}/10`;
      meta.appendChild(rating);
    }

    card.appendChild(meta);
    listEl.appendChild(card);
  }
}

async function renderDetail() {
  if (!selectedId) {
    detailEl.innerHTML = '<p class="empty">Select a video to edit</p>';
    return;
  }
  await renderEditor(detailEl, selectedId, {
    onSaved: () => refresh(),
    onDeleted: async () => {
      selectedId = null;
      await refresh();
      await renderDetail();
    },
  });
}

async function refresh() {
  const videos = await searchVideos({
    query: filters.query || undefined,
    tagNames: filters.tagNames.length ? filters.tagNames : undefined,
    ratingMin: filters.ratingMin > 1 ? filters.ratingMin : undefined,
    ratingMax: filters.ratingMax < 10 ? filters.ratingMax : undefined,
  });
  const videoTagsMap = new Map<string, Tag[]>();
  for (const v of videos) {
    videoTagsMap.set(v.videoId, await getVideoTags(v.videoId));
  }
  allTags = await listTags();
  renderTagSuggestions();
  renderList(videos, videoTagsMap);
}

let queryDebounce: number | undefined;
queryInput.addEventListener('input', () => {
  window.clearTimeout(queryDebounce);
  queryDebounce = window.setTimeout(() => {
    filters.query = queryInput.value.trim();
    void refresh();
  }, 200);
});

tagFilterInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const norm = normalizeTag(tagFilterInput.value);
    if (norm && !filters.tagNames.includes(norm)) {
      filters.tagNames.push(norm);
      tagFilterInput.value = '';
      renderTagFilters();
      void refresh();
    }
  }
});

ratingMinInput.addEventListener('change', () => {
  filters.ratingMin = Number(ratingMinInput.value) || 1;
  void refresh();
});
ratingMaxInput.addEventListener('change', () => {
  filters.ratingMax = Number(ratingMaxInput.value) || 10;
  void refresh();
});

function applyHash() {
  const h = window.location.hash.replace(/^#/, '');
  if (!h) return;
  const params = new URLSearchParams(h);
  const tag = params.get('tag');
  if (tag) {
    const norm = normalizeTag(tag);
    if (norm && !filters.tagNames.includes(norm)) {
      filters.tagNames.push(norm);
      renderTagFilters();
    }
  }
  const v = params.get('video');
  if (v) selectedId = v;
}

applyHash();

const backupBtn = document.getElementById('backup-btn') as HTMLButtonElement;
const backupStatusEl = document.getElementById('backup-status') as HTMLParagraphElement;

backupBtn.addEventListener('click', async () => {
  backupBtn.disabled = true;
  backupStatusEl.textContent = 'Готовлю бэкап…';
  try {
    const result = await exportBackup((p) => {
      if (p.stage === 'manifest') {
        backupStatusEl.textContent = p.message ?? 'Манифест…';
      } else if (p.stage === 'blobs') {
        const ratio = p.total ? `${p.current + 1}/${p.total}` : '';
        backupStatusEl.textContent = `Файлы ${ratio}${p.message ? ` · ${p.message}` : ''}`;
      }
    });
    const mfKb = (result.manifestBytes / 1024).toFixed(1);
    backupStatusEl.textContent =
      `↓ ~/Downloads/recensio-backup/ · новых ${result.newBlobs}, ` +
      `пропущено ${result.skippedBlobs} из ${result.totalBlobs}, manifest ${mfKb} KB.`;
  } catch (e) {
    backupStatusEl.textContent = `Ошибка: ${(e as Error).message}`;
  } finally {
    backupBtn.disabled = false;
  }
});

const importBtn = document.getElementById('import-btn') as HTMLButtonElement;
const importInput = document.getElementById('import-input') as HTMLInputElement;

importBtn.addEventListener('click', () => {
  // Reset value so picking the same folder twice still fires `change`.
  importInput.value = '';
  importInput.click();
});

importInput.addEventListener('change', async () => {
  const files = importInput.files ? Array.from(importInput.files) : [];
  if (!files.length) return;
  if (!confirm(
    `Импорт затрёт текущую базу и заменит её содержимым выбранной папки (${files.length} файлов). ` +
    `Сначала сделай бэкап текущего состояния, если оно тебе нужно. Продолжить?`,
  )) {
    return;
  }
  importBtn.disabled = true;
  backupBtn.disabled = true;
  backupStatusEl.textContent = 'Импорт…';
  try {
    const result = await importBackup(files, (p) => {
      const ratio = p.total ? `${p.current}/${p.total}` : '';
      backupStatusEl.textContent =
        `Импорт · ${p.stage} ${ratio}${p.message ? ` · ${p.message}` : ''}`;
    });
    backupStatusEl.textContent =
      `↑ Импорт готов: videos ${result.videos}, screenshots ${result.screenshots}, ` +
      `clips ${result.clips}` +
      (result.missingBlobs ? ` · отсутствует ${result.missingBlobs} файлов` : '') +
      '.';
    // Reload tag suggestions + list/detail from the freshly written DB.
    allTags = await listTags();
    renderTagSuggestions();
    selectedId = null;
    detailEl.innerHTML = '<p class="empty">Select a video to edit</p>';
    await refresh();
  } catch (e) {
    backupStatusEl.textContent = `Ошибка импорта: ${(e as Error).message}`;
  } finally {
    importBtn.disabled = false;
    backupBtn.disabled = false;
  }
});

void refresh().then(() => {
  if (selectedId) void renderDetail();
});
