import { db, type SystemTag } from './schema';

// Display-oriented normalization: keep spaces and original look, just trim,
// lowercase, drop a leading '#', collapse whitespace. We don't share the
// stricter user-tag normalization on purpose — these are read-only chips and
// should mirror what the source platform shows.
export function normalizeSystemTag(name: string): string {
  return name
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export async function listSystemTags(videoId: string): Promise<SystemTag[]> {
  return db.systemTags
    .where('videoId')
    .equals(videoId)
    .sortBy('name');
}

export async function setSystemTags(videoId: string, rawNames: string[]): Promise<void> {
  const names = [...new Set(rawNames.map(normalizeSystemTag).filter(Boolean))];
  const now = Date.now();
  await db.transaction('rw', db.systemTags, db.videos, async () => {
    await db.systemTags.where('videoId').equals(videoId).delete();
    if (names.length) {
      await db.systemTags.bulkAdd(
        names.map((name) => ({ videoId, name, createdAt: now })),
      );
    }
    await db.videos.update(videoId, { systemTagsFetchedAt: now });
  });
}
