import {
  getVideo,
  getVideoTags,
  setVideoTags,
  updateReview,
  deleteVideo,
  listTags,
  normalizeTag,
  listScreenshots,
  deleteScreenshot,
  type Screenshot,
} from '../db';

export interface EditorOptions {
  onSaved?: () => void | Promise<void>;
  onDeleted?: () => void | Promise<void>;
  showOpenLink?: boolean;
}

const editorCleanups = new WeakMap<HTMLElement, () => void>();

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

export async function renderEditor(
  root: HTMLElement,
  videoId: string,
  opts: EditorOptions = {},
): Promise<void> {
  editorCleanups.get(root)?.();
  editorCleanups.delete(root);
  root.innerHTML = '';

  const v = await getVideo(videoId);
  if (!v) {
    root.innerHTML = '<p class="empty">Not found</p>';
    return;
  }

  const tags = await getVideoTags(videoId);
  let pendingTags = tags.map((t) => t.name);
  const allTags = await listTags();

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
  sub.append(v.channel);
  if (opts.showOpenLink !== false) {
    sub.append(' · ');
    const link = document.createElement('a');
    link.href = `https://www.youtube.com/watch?v=${videoId}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open on YouTube ↗';
    sub.appendChild(link);
  }
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

  const datalistId = `editor-tags-${Math.random().toString(36).slice(2)}`;
  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.setAttribute('list', datalistId);
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

  const datalist = document.createElement('datalist');
  datalist.id = datalistId;
  for (const t of allTags) {
    const opt = document.createElement('option');
    opt.value = t.name;
    datalist.appendChild(opt);
  }
  wrap.appendChild(datalist);

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

  // Screenshots
  const shotsLabel = document.createElement('label');
  shotsLabel.textContent = 'Screenshots';
  wrap.appendChild(shotsLabel);

  const shotsBox = document.createElement('div');
  shotsBox.className = 'shots';
  wrap.appendChild(shotsBox);

  const objectUrls: string[] = [];
  editorCleanups.set(root, () => {
    for (const u of objectUrls) URL.revokeObjectURL(u);
    objectUrls.length = 0;
  });

  function openLightbox(url: string, alt: string) {
    const box = document.createElement('div');
    box.className = 'shot-lightbox';
    box.addEventListener('click', () => box.remove());
    const img = document.createElement('img');
    img.src = url;
    img.alt = alt;
    box.appendChild(img);
    document.body.appendChild(box);
  }

  async function renderShots() {
    for (const u of objectUrls) URL.revokeObjectURL(u);
    objectUrls.length = 0;
    shotsBox.innerHTML = '';
    const items: Screenshot[] = await listScreenshots(videoId);
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'shots-empty';
      empty.textContent = 'Нет скриншотов. Нажмите 📷 рядом с заголовком видео.';
      shotsBox.appendChild(empty);
      return;
    }
    for (const s of items) {
      const url = URL.createObjectURL(s.blob);
      objectUrls.push(url);
      const card = document.createElement('div');
      card.className = 'shot';

      const img = document.createElement('img');
      img.src = url;
      img.alt = `${fmtTime(s.timeSec)}`;
      img.addEventListener('click', () => openLightbox(url, img.alt));
      card.appendChild(img);

      const time = document.createElement('span');
      time.className = 'shot-time';
      time.textContent = fmtTime(s.timeSec);
      card.appendChild(time);

      const del = document.createElement('button');
      del.className = 'shot-del';
      del.type = 'button';
      del.title = 'Delete screenshot';
      del.textContent = '×';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (s.id == null) return;
        await deleteScreenshot(s.id);
        await renderShots();
      });
      card.appendChild(del);

      shotsBox.appendChild(card);
    }
  }
  await renderShots();

  // Actions
  const actions = document.createElement('div');
  actions.className = 'actions';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const ratingNum = Number(ratingInput.value);
    await updateReview(videoId, {
      rating: ratingNum > 0 ? ratingNum : undefined,
      review: reviewArea.value || undefined,
    });
    await setVideoTags(videoId, pendingTags);
    saveBtn.textContent = 'Saved ✓';
    await opts.onSaved?.();
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
    if (!confirm(`Delete "${v.title}"?`)) return;
    await deleteVideo(videoId);
    await opts.onDeleted?.();
  });
  actions.appendChild(delBtn);

  wrap.appendChild(actions);
  root.appendChild(wrap);
}
