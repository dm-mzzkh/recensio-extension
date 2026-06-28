import { db, type Video } from './schema';
import { normalizeTag } from './tags';

export interface SearchFilters {
  query?: string;
  tagNames?: string[]; // AND match
  ratingMin?: number;
  ratingMax?: number;
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
      if (candidateIds === null) {
        candidateIds = ids;
      } else {
        const merged = new Set<string>();
        for (const id of candidateIds) if (ids.has(id)) merged.add(id);
        candidateIds = merged;
      }
      if (!candidateIds.size) return [];
    }
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
