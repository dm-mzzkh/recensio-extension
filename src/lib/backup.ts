import {
  db,
  getLedgerKeys,
  addLedgerEntries,
  type Video,
  type Tag,
  type VideoTag,
  type SystemTag,
  type Screenshot,
  type Clip,
} from '../db';

const TARGET_DIR = 'recensio-backup';

export interface BackupProgress {
  stage: 'manifest' | 'blobs' | 'done';
  current: number;
  total: number;
  message?: string;
}

export interface BackupResult {
  manifestBytes: number;
  newBlobs: number;
  skippedBlobs: number;
  totalBlobs: number;
}

// Serializable view of a screenshot — blob is replaced with a filename ref
// that points at recensio-backup/blobs/<blobRef>.
interface ScreenshotManifest extends Omit<Screenshot, 'blob'> {
  blobRef: string;
}

interface ClipManifest extends Omit<Clip, 'blob'> {
  blobRef: string | null;
}

interface Manifest {
  schemaVersion: number;
  exportedAt: number;
  videos: Video[];
  tags: Tag[];
  videoTags: VideoTag[];
  systemTags: SystemTag[];
  screenshots: ScreenshotManifest[];
  clips: ClipManifest[];
}

function extFromMime(mime: string | undefined, fallback: string): string {
  if (!mime) return fallback;
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('gif')) return 'gif';
  return fallback;
}

function screenshotBlobRef(s: Screenshot): string {
  return `sc-${s.id}.${extFromMime(s.blob.type, 'jpg')}`;
}

function clipBlobRef(c: Clip): string | null {
  if (!c.blob || c.id == null) return null;
  return `cl-${c.id}.${extFromMime(c.mimeType ?? c.blob.type, 'mp4')}`;
}

async function gzipString(s: string): Promise<Blob> {
  const stream = new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

async function downloadBlob(blob: Blob, relativePath: string): Promise<void> {
  // browser.downloads streams from the object URL while writing the file, so
  // revoking too early kills the transfer. We keep them alive for the page
  // lifetime — Firefox revokes them on unload. Cost is negligible vs blob
  // size already in memory.
  const url = URL.createObjectURL(blob);
  await browser.downloads.download({
    url,
    filename: `${TARGET_DIR}/${relativePath}`,
    conflictAction: 'overwrite',
    saveAs: false,
  });
}

export async function exportBackup(
  onProgress?: (p: BackupProgress) => void,
): Promise<BackupResult> {
  // Snapshot every table. Order doesn't matter — the manifest groups by table
  // and import is responsible for the FK-ish dependencies (e.g. videoTags
  // refer to tag ids).
  const [videos, tags, videoTags, systemTags, screenshotRows, clipRows] = await Promise.all([
    db.videos.toArray(),
    db.tags.toArray(),
    db.videoTags.toArray(),
    db.systemTags.toArray(),
    db.screenshots.toArray(),
    db.clips.toArray(),
  ]);

  const screenshots: ScreenshotManifest[] = screenshotRows.map((s) => {
    const { blob: _blob, ...rest } = s;
    return { ...rest, blobRef: screenshotBlobRef(s) };
  });
  const clips: ClipManifest[] = clipRows.map((c) => {
    const { blob: _blob, ...rest } = c;
    return { ...rest, blobRef: clipBlobRef(c) };
  });

  const manifest: Manifest = {
    schemaVersion: db.verno,
    exportedAt: Date.now(),
    videos,
    tags,
    videoTags,
    systemTags,
    screenshots,
    clips,
  };

  onProgress?.({ stage: 'manifest', current: 0, total: 1, message: 'Сжимаю манифест…' });
  const manifestJson = JSON.stringify(manifest);
  const gzBlob = await gzipString(manifestJson);
  await downloadBlob(gzBlob, 'manifest.json.gz');
  onProgress?.({ stage: 'manifest', current: 1, total: 1 });

  // Build list of blob descriptors to ship (only those with actual bytes in
  // IDB and missing from the local ledger).
  interface PendingBlob {
    key: string;
    blob: Blob;
    relativePath: string;
  }
  const pending: PendingBlob[] = [];
  const ledger = await getLedgerKeys();
  for (const s of screenshotRows) {
    const ref = screenshotBlobRef(s);
    const key = `blobs/${ref}`;
    if (ledger.has(key)) continue;
    pending.push({ key, blob: s.blob, relativePath: `blobs/${ref}` });
  }
  for (const c of clipRows) {
    const ref = clipBlobRef(c);
    if (!ref || !c.blob) continue;
    const key = `blobs/${ref}`;
    if (ledger.has(key)) continue;
    pending.push({ key, blob: c.blob, relativePath: `blobs/${ref}` });
  }

  const totalBlobs = screenshotRows.length + clipRows.filter((c) => c.blob).length;
  const skippedBlobs = totalBlobs - pending.length;

  // Serialize downloads — kicking off 500 parallel browser.downloads.download
  // calls floods the Firefox download manager and confuses progress reporting.
  let ok = 0;
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    onProgress?.({
      stage: 'blobs',
      current: i,
      total: pending.length,
      message: p.relativePath,
    });
    try {
      await downloadBlob(p.blob, p.relativePath);
      await addLedgerEntries([p.key]);
      ok++;
    } catch (e) {
      console.error('[Recensio] backup blob failed', p.relativePath, e);
      // Keep going — one bad file shouldn't abort the whole export. Ledger
      // stays empty for this key so a retry will pick it up.
    }
  }

  onProgress?.({
    stage: 'done',
    current: pending.length,
    total: pending.length,
    message: `Готово: новых ${ok}, пропущено ${skippedBlobs}.`,
  });

  return {
    manifestBytes: gzBlob.size,
    newBlobs: ok,
    skippedBlobs,
    totalBlobs,
  };
}

// A cheap fingerprint of everything exportBackup would ship. The background
// auto-export compares this against the last successful run and skips the
// download entirely when nothing changed — otherwise a 5-min alarm would spam
// the browser's download history with identical manifests. Reads counts + a
// few max timestamps; never loads blob bytes into memory.
export async function computeDataSignature(): Promise<string> {
  const [videoCount, videoMaxDoc, tagCount, vtCount, stCount, scCount, clCount, readyClips, lastShot, lastClip] =
    await Promise.all([
      db.videos.count(),
      db.videos.orderBy('updatedAt').last(),
      db.tags.count(),
      db.videoTags.count(),
      db.systemTags.count(),
      db.screenshots.count(),
      db.clips.count(),
      db.clips.where('status').equals('ready').count(),
      db.screenshots.orderBy('createdAt').last(),
      db.clips.orderBy('createdAt').last(),
    ]);
  const videoMax = (videoMaxDoc as Video | undefined)?.updatedAt ?? 0;

  return [
    videoCount, videoMax,
    tagCount, vtCount, stCount,
    scCount, lastShot?.createdAt ?? 0,
    clCount, readyClips, lastClip?.createdAt ?? 0,
  ].join('|');
}

// ─── Import ────────────────────────────────────────────────────────────────

export type ImportMode = 'replace' | 'merge';

export interface ImportProgress {
  stage: 'reading' | 'validating' | 'wiping' | 'loading' | 'merging' | 'done';
  current: number;
  total: number;
  message?: string;
}

export interface ImportResult {
  mode: ImportMode;
  // For 'replace' these are totals loaded; for 'merge' they're rows
  // added/updated (existing untouched rows aren't counted).
  videos: number;
  tags: number;
  videoTags: number;
  systemTags: number;
  screenshots: number;
  clips: number;
  missingBlobs: number;
}

function relPath(f: File): string {
  // webkitdirectory inputs expose webkitRelativePath (e.g.
  // "recensio-backup/blobs/sc-7.jpg"); plain multi-file inputs leave it empty,
  // so fall back to the bare name.
  const wp = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
  return wp || f.name;
}

function fileBasename(f: File): string {
  const p = relPath(f);
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function mimeFromExt(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  return 'application/octet-stream';
}

async function readManifest(file: File): Promise<Manifest> {
  const isGz = /\.gz$/i.test(file.name);
  let text: string;
  if (isGz) {
    const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else {
    text = await file.text();
  }
  const parsed = JSON.parse(text) as Manifest;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.schemaVersion !== 'number') {
    throw new Error('manifest.json: невалидный формат');
  }
  return parsed;
}

export async function importBackup(
  files: File[],
  onProgress?: (p: ImportProgress) => void,
  mode: ImportMode = 'replace',
): Promise<ImportResult> {
  onProgress?.({ stage: 'reading', current: 0, total: 1, message: 'Ищу manifest…' });

  const manifestFile = files.find((f) => /manifest\.json(\.gz)?$/i.test(fileBasename(f)));
  if (!manifestFile) {
    throw new Error('manifest.json(.gz) не найден в выбранной папке.');
  }

  // Map basename → File for everything except the manifest itself. blobRefs
  // in the manifest are bare basenames (e.g. "sc-7.jpg"), not paths, so this
  // is the right key.
  const blobByName = new Map<string, File>();
  for (const f of files) {
    if (f === manifestFile) continue;
    blobByName.set(fileBasename(f), f);
  }

  onProgress?.({ stage: 'reading', current: 1, total: 1, message: 'Парсю manifest…' });
  const manifest = await readManifest(manifestFile);

  onProgress?.({ stage: 'validating', current: 0, total: 1 });
  if (manifest.schemaVersion > db.verno) {
    throw new Error(
      `Бэкап создан в более новой схеме (v${manifest.schemaVersion}); ` +
      `обновите расширение (текущая v${db.verno}).`,
    );
  }
  if (manifest.schemaVersion < db.verno) {
    // Older snapshots would need explicit JS migrations here (Dexie's
    // version().upgrade() only fires on db open, not on writes). For MVP all
    // backups produced by exportBackup() are at the current schema, so we
    // refuse rather than silently corrupting data.
    throw new Error(
      `Бэкап сделан в более старой схеме (v${manifest.schemaVersion}); ` +
      `миграция при импорте пока не реализована (текущая v${db.verno}).`,
    );
  }

  // Build screenshot/clip rows synchronously — Blob construction is lazy, so
  // we don't read the underlying disk bytes here. Putting these into IDB will
  // stream the bytes on commit without flooding the JS heap.
  let missingBlobs = 0;

  const shotRows: Screenshot[] = [];
  for (const s of manifest.screenshots) {
    const file = blobByName.get(s.blobRef);
    if (!file) {
      missingBlobs++;
      continue;
    }
    const { blobRef: _ref, ...rest } = s;
    shotRows.push({
      ...rest,
      blob: new Blob([file], { type: mimeFromExt(s.blobRef) }),
    });
  }

  const clipRows: Clip[] = [];
  for (const c of manifest.clips) {
    const { blobRef, ...rest } = c;
    let blob: Blob | undefined;
    if (blobRef) {
      const file = blobByName.get(blobRef);
      if (file) {
        blob = new Blob([file], { type: rest.mimeType ?? mimeFromExt(blobRef) });
      } else {
        // Clip metadata stays — bytes just aren't there. UI already handles
        // the no-blob case (shows pending/error placeholder).
        missingBlobs++;
      }
    }
    clipRows.push({ ...rest, blob });
  }

  // blobRefs present on disk — used both to seed the ledger and (in merge) to
  // know which manifest blobs we actually have bytes for.
  const presentBlobRefs = new Set<string>();
  for (const s of manifest.screenshots) if (blobByName.has(s.blobRef)) presentBlobRefs.add(s.blobRef);
  for (const c of manifest.clips) if (c.blobRef && blobByName.has(c.blobRef)) presentBlobRefs.add(c.blobRef);

  const TABLES = [
    db.videos,
    db.tags,
    db.videoTags,
    db.systemTags,
    db.screenshots,
    db.clips,
    db.backupLedger,
  ];

  if (mode === 'merge') {
    const result = await mergeManifest(manifest, shotRows, clipRows, presentBlobRefs, onProgress);
    onProgress?.({ stage: 'done', current: 1, total: 1 });
    return { mode, missingBlobs, ...result };
  }

  onProgress?.({ stage: 'wiping', current: 0, total: 1, message: 'Чищу таблицы…' });

  // Single rw tx across every table. All clears + all puts in one shot so a
  // crash mid-import leaves the DB unchanged rather than half-loaded.
  await db.transaction('rw', TABLES, async () => {
    await db.videos.clear();
    await db.tags.clear();
    await db.videoTags.clear();
    await db.systemTags.clear();
    await db.screenshots.clear();
    await db.clips.clear();
    await db.backupLedger.clear();

    onProgress?.({ stage: 'loading', current: 0, total: 6, message: 'videos' });
    if (manifest.videos.length) await db.videos.bulkPut(manifest.videos);
    onProgress?.({ stage: 'loading', current: 1, total: 6, message: 'tags' });
    if (manifest.tags.length) await db.tags.bulkPut(manifest.tags);
    onProgress?.({ stage: 'loading', current: 2, total: 6, message: 'videoTags' });
    if (manifest.videoTags.length) await db.videoTags.bulkPut(manifest.videoTags);
    onProgress?.({ stage: 'loading', current: 3, total: 6, message: 'systemTags' });
    if (manifest.systemTags.length) await db.systemTags.bulkPut(manifest.systemTags);
    onProgress?.({ stage: 'loading', current: 4, total: 6, message: 'screenshots' });
    if (shotRows.length) await db.screenshots.bulkPut(shotRows);
    onProgress?.({ stage: 'loading', current: 5, total: 6, message: 'clips' });
    if (clipRows.length) await db.clips.bulkPut(clipRows);

    // Seed the ledger with everything we just imported. Without this, the
    // very next exportBackup() would re-ship every blob to Downloads.
    const now = Date.now();
    const ledgerRows = [...presentBlobRefs].map((ref) => ({
      blobKey: `blobs/${ref}`,
      exportedAt: now,
    }));
    if (ledgerRows.length) await db.backupLedger.bulkAdd(ledgerRows);
    onProgress?.({ stage: 'loading', current: 6, total: 6 });
  });

  onProgress?.({ stage: 'done', current: 1, total: 1 });

  return {
    mode,
    videos: manifest.videos.length,
    tags: manifest.tags.length,
    videoTags: manifest.videoTags.length,
    systemTags: manifest.systemTags.length,
    screenshots: shotRows.length,
    clips: clipRows.length,
    missingBlobs,
  };
}

// Additive merge: never deletes. Videos resolve by videoId with last-write-wins
// on updatedAt; tags resolve by name (their auto-increment ids differ between
// DBs, so we remap into videoTags); the rest dedup on their natural compound
// keys ([videoId+tagId], [videoId+name], [videoId+createdAt], [videoId+startSec]).
// Everything runs in one rw tx so a crash leaves the DB untouched.
async function mergeManifest(
  manifest: Manifest,
  shotRows: Screenshot[],
  clipRows: Clip[],
  presentBlobRefs: Set<string>,
  onProgress?: (p: ImportProgress) => void,
): Promise<Omit<ImportResult, 'mode' | 'missingBlobs'>> {
  onProgress?.({ stage: 'merging', current: 0, total: 1, message: 'Объединяю…' });

  let videosMerged = 0;
  let tagsAdded = 0;
  let videoTagsAdded = 0;
  let systemTagsAdded = 0;
  let screenshotsAdded = 0;
  let clipsAdded = 0;

  await db.transaction(
    'rw',
    [db.videos, db.tags, db.videoTags, db.systemTags, db.screenshots, db.clips, db.backupLedger],
    async () => {
      // videos — last-write-wins by updatedAt.
      const existingVideos = new Map(
        (await db.videos.toArray()).map((v) => [v.videoId, v.updatedAt ?? 0]),
      );
      const videosToPut = manifest.videos.filter((v) => {
        const cur = existingVideos.get(v.videoId);
        return cur === undefined || v.updatedAt > cur;
      });
      if (videosToPut.length) await db.videos.bulkPut(videosToPut);
      videosMerged = videosToPut.length;

      // tags — resolve by name, build old-id → current-id remap for videoTags.
      const tagIdByName = new Map(
        (await db.tags.toArray()).map((t) => [t.name, t.id as number]),
      );
      const tagIdMap = new Map<number, number>();
      for (const t of manifest.tags) {
        let id = tagIdByName.get(t.name);
        if (id === undefined) {
          id = (await db.tags.add({ name: t.name, createdAt: t.createdAt })) as number;
          tagIdByName.set(t.name, id);
          tagsAdded++;
        }
        if (t.id != null) tagIdMap.set(t.id, id);
      }

      // videoTags — dedup on [videoId + remapped tagId].
      const vtKey = (vid: string, tid: number) => `${vid} ${tid}`;
      const seenVT = new Set(
        (await db.videoTags.toArray()).map((x) => vtKey(x.videoId, x.tagId)),
      );
      const vtToAdd: VideoTag[] = [];
      for (const vt of manifest.videoTags) {
        const tid = tagIdMap.get(vt.tagId);
        if (tid == null) continue; // tag missing from manifest — skip orphan link
        const k = vtKey(vt.videoId, tid);
        if (seenVT.has(k)) continue;
        seenVT.add(k);
        vtToAdd.push({ videoId: vt.videoId, tagId: tid });
      }
      if (vtToAdd.length) await db.videoTags.bulkAdd(vtToAdd);
      videoTagsAdded = vtToAdd.length;

      // systemTags — dedup on [videoId + name].
      const stKey = (vid: string, name: string) => `${vid} ${name}`;
      const seenST = new Set(
        (await db.systemTags.toArray()).map((x) => stKey(x.videoId, x.name)),
      );
      const stToAdd: SystemTag[] = [];
      for (const st of manifest.systemTags) {
        const k = stKey(st.videoId, st.name);
        if (seenST.has(k)) continue;
        seenST.add(k);
        stToAdd.push({ videoId: st.videoId, name: st.name, createdAt: st.createdAt });
      }
      if (stToAdd.length) await db.systemTags.bulkAdd(stToAdd);
      systemTagsAdded = stToAdd.length;

      // screenshots — dedup on [videoId + createdAt], drop the backup's id.
      const scKey = (vid: string, ts: number) => `${vid} ${ts}`;
      const seenSC = new Set(
        (await db.screenshots.toArray()).map((x) => scKey(x.videoId, x.createdAt)),
      );
      const scToAdd = shotRows
        .filter((s) => {
          const k = scKey(s.videoId, s.createdAt);
          if (seenSC.has(k)) return false;
          seenSC.add(k);
          return true;
        })
        .map(({ id: _id, ...rest }) => rest);
      if (scToAdd.length) await db.screenshots.bulkAdd(scToAdd);
      screenshotsAdded = scToAdd.length;

      // clips — dedup on [videoId + startSec], drop the backup's id.
      const clKey = (vid: string, start: number) => `${vid} ${start}`;
      const seenCL = new Set(
        (await db.clips.toArray()).map((x) => clKey(x.videoId, x.startSec)),
      );
      const clToAdd = clipRows
        .filter((c) => {
          const k = clKey(c.videoId, c.startSec);
          if (seenCL.has(k)) return false;
          seenCL.add(k);
          return true;
        })
        .map(({ id: _id, ...rest }) => rest);
      if (clToAdd.length) await db.clips.bulkAdd(clToAdd);
      clipsAdded = clToAdd.length;

      // ledger — mark the blobs we now hold so the next export skips them.
      const seenLedger = new Set((await db.backupLedger.toArray()).map((l) => l.blobKey));
      const now = Date.now();
      const ledgerToAdd: { blobKey: string; exportedAt: number }[] = [];
      for (const ref of presentBlobRefs) {
        const key = `blobs/${ref}`;
        if (seenLedger.has(key)) continue;
        seenLedger.add(key);
        ledgerToAdd.push({ blobKey: key, exportedAt: now });
      }
      if (ledgerToAdd.length) await db.backupLedger.bulkAdd(ledgerToAdd);
    },
  );

  return {
    videos: videosMerged,
    tags: tagsAdded,
    videoTags: videoTagsAdded,
    systemTags: systemTagsAdded,
    screenshots: screenshotsAdded,
    clips: clipsAdded,
  };
}
