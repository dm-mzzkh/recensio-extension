import {
  searchVideos,
  getVideo,
  getVideoTags,
  setVideoTags,
  updateReview,
  deleteVideo,
  listTags,
  normalizeTag,
  type Video,
  type Tag,
} from '../db';

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
  const v = await getVideo(selectedId);
  if (!v) {
    detailEl.innerHTML = '<p class="empty">Not found</p>';
    return;
  }
  const tags = await getVideoTags(selectedId);
  let pendingTags = tags.map((t) => t.name);

  detailEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'detail';

  const thumb = document.createElement('img');
  thumb.className = 'detail-thumb';
  thumb.src = v.thumbnail;
  wrap.appendChild(thumb);

  const title = document.createElement('h2');
  title.textContent = v.title;
  wrap.appendChild(title);

  const sub = document.createElement('p');
  sub.className = 'detail-sub';
  sub.append(`${v.channel} · `);
  const link = document.createElement('a');
  link.href = `https://www.youtube.com/watch?v=${v.videoId}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Open on YouTube ↗';
  sub.appendChild(link);
  wrap.appendChild(sub);

  // Tags
  const tagsLabel = document.createElement('label');
  tagsLabel.textContent = 'Tags';
  wrap.appendChild(tagsLabel);

  const tagsBox = document.createElement('div');
  tagsBox.className = 'chips';
  wrap.appendChild(tagsBox);

  function renderPendingTags() {
    tagsBox.innerHTML = '';
    for (const tag of pendingTags) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `#${tag}`;
      const x = document.createElement('button');
      x.className = 'chip-remove';
      x.textContent = '×';
      x.addEventListener('click', () => {
        pendingTags = pendingTags.filter((t) => t !== tag);
        renderPendingTags();
      });
      chip.appendChild(x);
      tagsBox.appendChild(chip);
    }
  }
  renderPendingTags();

  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.setAttribute('list', 'all-tags-list');
  tagInput.placeholder = 'Add tag (Enter or comma)';
  tagInput.autocomplete = 'off';
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const norm = normalizeTag(tagInput.value);
      if (norm && !pendingTags.includes(norm)) {
        pendingTags.push(norm);
        renderPendingTags();
      }
      tagInput.value = '';
    } else if (e.key === 'Backspace' && tagInput.value === '' && pendingTags.length) {
      pendingTags.pop();
      renderPendingTags();
    }
  });
  wrap.appendChild(tagInput);

  // Rating
  const ratingLabel = document.createElement('label');
  ratingLabel.textContent = 'Rating';
  wrap.appendChild(ratingLabel);

  const ratingRow = document.createElement('div');
  ratingRow.className = 'rating-row';
  const ratingInput = document.createElement('input');
  ratingInput.type = 'range';
  ratingInput.min = '0';
  ratingInput.max = '10';
  ratingInput.value = String(v.rating ?? 0);
  ratingInput.className = 'rating-slider';
  const ratingValue = document.createElement('span');
  ratingValue.className = 'rating-value';
  ratingValue.textContent = v.rating != null ? `★ ${v.rating}/10` : '— / 10';
  ratingInput.addEventListener('input', () => {
    const n = Number(ratingInput.value);
    ratingValue.textContent = n === 0 ? '— / 10' : `★ ${n}/10`;
  });
  ratingRow.appendChild(ratingInput);
  ratingRow.appendChild(ratingValue);
  wrap.appendChild(ratingRow);

  // Review
  const reviewLabel = document.createElement('label');
  reviewLabel.textContent = 'Review';
  wrap.appendChild(reviewLabel);

  const reviewArea = document.createElement('textarea');
  reviewArea.className = 'review';
  reviewArea.rows = 8;
  reviewArea.placeholder = 'Write your review…';
  reviewArea.value = v.review ?? '';
  wrap.appendChild(reviewArea);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'actions';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    if (!selectedId) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const ratingNum = Number(ratingInput.value);
    await updateReview(selectedId, {
      rating: ratingNum > 0 ? ratingNum : undefined,
      review: reviewArea.value || undefined,
    });
    await setVideoTags(selectedId, pendingTags);
    saveBtn.textContent = 'Saved ✓';
    await refresh();
    setTimeout(() => {
      saveBtn.textContent = 'Save';
      saveBtn.disabled = false;
    }, 800);
  });
  actions.appendChild(saveBtn);

  const delBtn = document.createElement('button');
  delBtn.textContent = 'Delete';
  delBtn.className = 'danger';
  delBtn.addEventListener('click', async () => {
    if (!selectedId) return;
    if (!confirm(`Delete "${v.title}"?`)) return;
    await deleteVideo(selectedId);
    selectedId = null;
    await refresh();
    void renderDetail();
  });
  actions.appendChild(delBtn);

  wrap.appendChild(actions);
  detailEl.appendChild(wrap);
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

void refresh();
