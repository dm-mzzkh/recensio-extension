import { db, type Video } from './schema';
import { normalizeTag } from './tags';

export interface SearchFilters {
  query?: string;
  tagNames?: string[]; // AND match
  ratingMin?: number;
  ratingMax?: number;
  collectionId?: number;
}

function intersect<T>(prev: Set<T> | null, next: Set<T>): Set<T> {
  if (prev === null) return next;
  const out = new Set<T>();
  for (const v of prev) if (next.has(v)) out.add(v);
  return out;
}

export async function searchVideos(filters: SearchFilters): Promise<Video[]> {
  let candidateIds: Set<string> | null = null;

  if (filters.tagNames?.length) {
    const wanted = filters.tagNames.map(normalizeTag).filter(Boolean);
    const tags = await db.tags.where('name').anyOf(wanted).toArray();
    if (tags.length !== wanted.length) return [];
    for (const tag of tags) {
      if (tag.id == null) continue;
      const links = await db.videoTags.where('tagId').equals(tag.id).toArray();
      const ids = new Set(links.map((l) => l.videoId));
      candidateIds = intersect(candidateIds, ids);
      if (!candidateIds.size) return [];
    }
  }

  if (filters.collectionId != null) {
    const items = await db.collectionItems
      .where('collectionId')
      .equals(filters.collectionId)
      .toArray();
    const ids = new Set(items.map((i) => i.videoId));
    candidateIds = intersect(candidateIds, ids);
    if (!candidateIds.size) return [];
  }

  const all = candidateIds
    ? (await db.videos.bulkGet([...candidateIds])).filter((v): v is Video => v != null)
    : await db.videos.toArray();

  const q = filters.query?.toLowerCase();
  return all
    .filter((v) => {
      if (filters.ratingMin != null && (v.rating ?? 0) < filters.ratingMin) return false;
      if (filters.ratingMax != null && (v.rating ?? 11) > filters.ratingMax) return false;
      if (q && !v.title.toLowerCase().includes(q) && !v.channel.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.addedAt - a.addedAt);
}
