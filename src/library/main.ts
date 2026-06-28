import {
  searchVideos,
  getVideoTags,
  listTags,
  normalizeTag,
  db,
  type Video,
  type Tag,
} from '../db';
import { renderEditor } from '../lib/editor';
import { exportBackup, importBackup, type ImportMode } from '../lib/backup';
import { getBackupSettings, setBackupSettings } from '../lib/settings';

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
const importBtn = document.getElementById('import-btn') as HTMLButtonElement;
const importInput = document.getElementById('import-input') as HTMLInputElement;

// Which import semantics the next folder pick should use. Set synchronously by
// whichever control opened the picker (replace / merge / restore-banner).
let pendingImportMode: ImportMode = 'replace';

// ── Injected controls ──────────────────────────────────────────────────────
// The library's index.html is intentionally hand-maintained, so the new
// toggles / merge button / restore banner are created here in JS rather than
// in markup.

// Merge button sits next to the existing replace-import button.
const mergeBtn = document.createElement('button');
mergeBtn.type = 'button';
mergeBtn.className = 'page-btn';
mergeBtn.textContent = '⤵ Merge';
mergeBtn.title =
  'Объединить бэкап с текущей базой: ничего не удаляется, при совпадении ' +
  'видео берётся более свежая версия (по дате изменения).';
importBtn.insertAdjacentElement('afterend', mergeBtn);

// Auto-backup / auto-restore toggles, persisted in storage.local (default on).
const settingsBar = document.createElement('div');
settingsBar.style.cssText =
  'display:flex; gap:18px; align-items:center; font-size:12px; color:#94a3b8; ' +
  'margin:-4px 0 12px; flex-wrap:wrap;';

function makeToggle(text: string, title: string): { wrap: HTMLLabelElement; cb: HTMLInputElement } {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:inline-flex; gap:6px; align-items:center; cursor:pointer;';
  wrap.title = title;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.style.cursor = 'pointer';
  wrap.appendChild(cb);
  wrap.appendChild(document.createTextNode(text));
  settingsBar.appendChild(wrap);
  return { wrap, cb };
}

const autoBackupToggle = makeToggle(
  'Авто-бэкап каждые 5 мин',
  'Фоновый экспорт в ~/Downloads/recensio-backup/ раз в 5 минут (только при изменениях).',
);
const autoRestoreToggle = makeToggle(
  'Предлагать восстановление при пустой базе',
  'Если база пуста при открытии библиотеки — показать баннер восстановления из бэкапа.',
);
backupStatusEl.insertAdjacentElement('afterend', settingsBar);

void getBackupSettings().then((s) => {
  autoBackupToggle.cb.checked = s.autoBackup;
  autoRestoreToggle.cb.checked = s.autoRestore;
});
autoBackupToggle.cb.addEventListener('change', () => {
  void setBackupSettings({ autoBackup: autoBackupToggle.cb.checked });
});
autoRestoreToggle.cb.addEventListener('change', () => {
  void setBackupSettings({ autoRestore: autoRestoreToggle.cb.checked });
  void maybeShowRestoreBanner();
});

// Restore banner — shown when the DB is empty and auto-restore is enabled.
const restoreBanner = document.createElement('div');
restoreBanner.style.cssText =
  'display:none; align-items:center; gap:12px; background:#1e293b; ' +
  'border:1px solid #334155; border-radius:6px; padding:10px 14px; ' +
  'margin-bottom:12px; font-size:13px; color:#e2e8f0;';
const bannerText = document.createElement('span');
bannerText.style.flex = '1';
bannerText.textContent =
  'База пуста. Восстановить из папки recensio-backup?';
const restoreBtn = document.createElement('button');
restoreBtn.type = 'button';
restoreBtn.className = 'page-btn';
restoreBtn.textContent = '↺ Восстановить из бэкапа';
restoreBtn.addEventListener('click', () => {
  pendingImportMode = 'replace';
  importInput.value = '';
  importInput.click();
});
restoreBanner.appendChild(bannerText);
restoreBanner.appendChild(restoreBtn);
settingsBar.insertAdjacentElement('afterend', restoreBanner);

async function maybeShowRestoreBanner() {
  const { autoRestore } = await getBackupSettings();
  const empty = (await db.videos.count()) === 0;
  restoreBanner.style.display = autoRestore && empty ? 'flex' : 'none';
}

// ── Backup / import handlers ─────────────────────────────────────────────────
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

importBtn.addEventListener('click', () => {
  pendingImportMode = 'replace';
  // Reset value so picking the same folder twice still fires `change`.
  importInput.value = '';
  importInput.click();
});
mergeBtn.addEventListener('click', () => {
  pendingImportMode = 'merge';
  importInput.value = '';
  importInput.click();
});

importInput.addEventListener('change', async () => {
  const files = importInput.files ? Array.from(importInput.files) : [];
  if (!files.length) return;
  const mode = pendingImportMode;
  const confirmMsg =
    mode === 'merge'
      ? `Merge объединит выбранную папку (${files.length} файлов) с текущей базой: ` +
        `ничего не удаляется, при совпадении видео берётся более свежая версия. Продолжить?`
      : `Импорт затрёт текущую базу и заменит её содержимым выбранной папки (${files.length} файлов). ` +
        `Сначала сделай бэкап текущего состояния, если оно тебе нужно. Продолжить?`;
  if (!confirm(confirmMsg)) return;

  importBtn.disabled = true;
  mergeBtn.disabled = true;
  backupBtn.disabled = true;
  restoreBtn.disabled = true;
  backupStatusEl.textContent = mode === 'merge' ? 'Merge…' : 'Импорт…';
  try {
    const result = await importBackup(
      files,
      (p) => {
        const ratio = p.total ? `${p.current}/${p.total}` : '';
        backupStatusEl.textContent =
          `${mode === 'merge' ? 'Merge' : 'Импорт'} · ${p.stage} ${ratio}` +
          `${p.message ? ` · ${p.message}` : ''}`;
      },
      mode,
    );
    const verb = result.mode === 'merge' ? '⤵ Merge готов: +' : '↑ Импорт готов: ';
    backupStatusEl.textContent =
      `${verb}videos ${result.videos}, screenshots ${result.screenshots}, ` +
      `clips ${result.clips}` +
      (result.missingBlobs ? ` · отсутствует ${result.missingBlobs} файлов` : '') +
      '.';
    // Reload tag suggestions + list/detail from the freshly written DB.
    allTags = await listTags();
    renderTagSuggestions();
    selectedId = null;
    detailEl.innerHTML = '<p class="empty">Select a video to edit</p>';
    await refresh();
    await maybeShowRestoreBanner();
  } catch (e) {
    backupStatusEl.textContent = `Ошибка: ${(e as Error).message}`;
  } finally {
    importBtn.disabled = false;
    mergeBtn.disabled = false;
    backupBtn.disabled = false;
    restoreBtn.disabled = false;
  }
});

void refresh().then(() => {
  if (selectedId) void renderDetail();
  void maybeShowRestoreBanner();
});
