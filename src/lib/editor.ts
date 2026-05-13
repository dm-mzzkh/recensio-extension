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
  listClips,
  updateClip,
  deleteClip,
  type Screenshot,
  type Clip,
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

  // Clips
  const clipsLabel = document.createElement('label');
  clipsLabel.textContent = 'Clips';
  wrap.appendChild(clipsLabel);

  const clipsBox = document.createElement('div');
  clipsBox.className = 'clips';
  wrap.appendChild(clipsBox);

  const clipsActions = document.createElement('div');
  clipsActions.className = 'clips-actions';
  wrap.appendChild(clipsActions);

  async function renderClips() {
    clipsBox.innerHTML = '';
    clipsActions.innerHTML = '';
    const items: Clip[] = await listClips(videoId);
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'clips-empty';
      empty.textContent = 'Нет клипов. Нажмите ✂ рядом с заголовком видео — первый клик ставит начало, второй конец.';
      clipsBox.appendChild(empty);
      return;
    }

    for (const c of items) {
      const card = document.createElement('div');
      card.className = 'clip';

      const head = document.createElement('div');
      head.className = 'clip-head';

      const range = document.createElement('a');
      range.className = 'clip-range';
      range.href = `https://youtu.be/${videoId}?t=${Math.floor(c.startSec)}`;
      range.target = '_blank';
      range.rel = 'noopener';
      range.title = 'Открыть на YouTube с момента начала клипа';
      range.textContent = `${fmtTime(c.startSec)} – ${fmtTime(c.endSec)}`;
      head.appendChild(range);

      const dur = document.createElement('span');
      dur.className = 'clip-dur';
      const dims = c.width && c.height ? ` · ${c.width}×${c.height}` : '';
      const size = c.blob ? ` · ${(c.blob.size / 1_048_576).toFixed(1)} МБ` : '';
      dur.textContent = `${(c.endSec - c.startSec).toFixed(1)} c${dims}${size}`;
      head.appendChild(dur);

      const ytDlp = document.createElement('button');
      ytDlp.className = 'clip-ytdlp';
      ytDlp.type = 'button';
      ytDlp.title = 'Скопировать команду yt-dlp для скачивания клипа';
      ytDlp.textContent = 'yt-dlp';
      ytDlp.addEventListener('click', async () => {
        const cmd = ytDlpCommand(videoId, c.startSec, c.endSec);
        try {
          await navigator.clipboard.writeText(cmd);
          ytDlp.textContent = 'Copied ✓';
          setTimeout(() => (ytDlp.textContent = 'yt-dlp'), 900);
        } catch {
          ytDlp.textContent = 'Copy failed';
          setTimeout(() => (ytDlp.textContent = 'yt-dlp'), 1500);
        }
      });
      head.appendChild(ytDlp);

      if (c.blob) {
        const dl = document.createElement('a');
        dl.className = 'clip-download';
        const url = URL.createObjectURL(c.blob);
        objectUrls.push(url);
        dl.href = url;
        const ext = (c.mimeType ?? 'video/webm').includes('webm') ? 'webm' : 'mp4';
        dl.download = `clip-${videoId}-${Math.floor(c.startSec)}-${Math.floor(c.endSec)}.${ext}`;
        dl.title = 'Скачать файл клипа';
        dl.textContent = '↓';
        head.appendChild(dl);
      }

      const del = document.createElement('button');
      del.className = 'clip-del';
      del.type = 'button';
      del.title = 'Delete clip';
      del.textContent = '×';
      del.addEventListener('click', async () => {
        if (c.id == null) return;
        await deleteClip(c.id);
        await renderClips();
      });
      head.appendChild(del);

      card.appendChild(head);

      if (c.blob) {
        const vid = document.createElement('video');
        vid.className = 'clip-video';
        vid.controls = true;
        vid.preload = 'metadata';
        const vidUrl = URL.createObjectURL(c.blob);
        objectUrls.push(vidUrl);
        vid.src = vidUrl;
        card.appendChild(vid);
      } else if (c.status === 'error') {
        const errBox = document.createElement('div');
        errBox.className = 'clip-error';
        const hd = document.createElement('div');
        hd.className = 'clip-error-head';
        hd.textContent = '⚠ Не удалось скачать клип через yt-dlp/ffmpeg';
        errBox.appendChild(hd);
        const detail = document.createElement('pre');
        detail.className = 'clip-error-detail';
        detail.textContent = c.errorMsg ?? '(нет деталей — проверьте Browser Console на стороне background)';
        errBox.appendChild(detail);
        card.appendChild(errBox);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'clip-pending';
        const main = document.createElement('div');
        main.textContent = '⏳ Скачивается через yt-dlp + ffmpeg…';
        placeholder.appendChild(main);
        const stage = document.createElement('div');
        stage.className = 'clip-pending-stage';
        stage.textContent = c.stage ? `стадия: ${c.stage}` : 'стадия: ожидание native host';
        placeholder.appendChild(stage);
        card.appendChild(placeholder);
      }

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'clip-title';
      titleInput.placeholder = 'Title (optional)';
      titleInput.value = c.title ?? '';
      titleInput.addEventListener('change', async () => {
        if (c.id == null) return;
        await updateClip(c.id, { title: titleInput.value || undefined });
      });
      card.appendChild(titleInput);

      const noteArea = document.createElement('textarea');
      noteArea.className = 'clip-note';
      noteArea.rows = 2;
      noteArea.placeholder = 'Note (optional)';
      noteArea.value = c.note ?? '';
      noteArea.addEventListener('change', async () => {
        if (c.id == null) return;
        await updateClip(c.id, { note: noteArea.value || undefined });
      });
      card.appendChild(noteArea);

      clipsBox.appendChild(card);
    }

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'clips-export';
    refreshBtn.textContent = '↻ Обновить';
    refreshBtn.title = 'Перезагрузить список (после фоновой записи)';
    refreshBtn.addEventListener('click', () => {
      void renderClips();
    });
    clipsActions.appendChild(refreshBtn);
  }
  await renderClips();

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
