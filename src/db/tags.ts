import { db, type Tag } from './schema';

export function normalizeTag(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_а-яё]/gi, '');
}

export async function listTags(): Promise<Tag[]> {
  return db.tags.orderBy('name').toArray();
}

export async function listTagsWithCounts(): Promise<Array<Tag & { count: number }>> {
  const tags = await listTags();
  const counts = new Map<number, number>();
  await db.videoTags.each(({ tagId }) => {
    counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
  });
  return tags.map((t) => ({ ...t, count: t.id != null ? counts.get(t.id) ?? 0 : 0 }));
}

export async function findTagsByPrefix(prefix: string, limit = 10): Promise<Tag[]> {
  const normalized = normalizeTag(prefix);
  if (!normalized) return [];
  return db.tags.where('name').startsWith(normalized).limit(limit).toArray();
}

export async function setVideoTags(videoId: string, rawNames: string[]): Promise<void> {
  const names = [...new Set(rawNames.map(normalizeTag).filter(Boolean))];
  await db.transaction('rw', db.tags, db.videoTags, async () => {
    const tagIds: number[] = [];
    for (const name of names) {
      const existing = await db.tags.where('name').equals(name).first();
      const id = existing?.id ?? (await db.tags.add({ name, createdAt: Date.now() }));
      tagIds.push(id);
    }
    await db.videoTags.where('videoId').equals(videoId).delete();
    if (tagIds.length) {
      await db.videoTags.bulkAdd(tagIds.map((tagId) => ({ videoId, tagId })));
    }
  });
}

export async function getVideoTags(videoId: string): Promise<Tag[]> {
  const links = await db.videoTags.where('videoId').equals(videoId).toArray();
  if (!links.length) return [];
  const tags = await db.tags.bulkGet(links.map((l) => l.tagId));
  return tags.filter((t): t is Tag => t != null);
}
