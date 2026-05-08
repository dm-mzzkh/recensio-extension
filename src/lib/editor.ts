import {
  getVideo,
  getVideoTags,
  setVideoTags,
  updateReview,
  deleteVideo,
  listTags,
  normalizeTag,
} from '../db';

export interface EditorOptions {
  onSaved?: () => void | Promise<void>;
  onDeleted?: () => void | Promise<void>;
  showOpenLink?: boolean;
}

export async function renderEditor(
  root: HTMLElement,
  videoId: string,
  opts: EditorOptions = {},
): Promise<void> {
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
