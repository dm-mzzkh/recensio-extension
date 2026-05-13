import { db, type Video } from './schema';

export type VideoMeta = Pick<
  Video,
  'videoId' | 'source' | 'url' | 'title' | 'channel' | 'thumbnail' | 'durationSec'
>;

export async function getVideo(videoId: string): Promise<Video | undefined> {
  return db.videos.get(videoId);
}

export async function saveVideo(meta: VideoMeta): Promise<void> {
  const now = Date.now();
  const existing = await db.videos.get(meta.videoId);
  if (existing) {
    await db.videos.update(meta.videoId, { ...meta, updatedAt: now });
  } else {
    await db.videos.put({ ...meta, addedAt: now, updatedAt: now });
  }
}

export async function updateReview(
  videoId: string,
  patch: { rating?: number; review?: string },
): Promise<void> {
  await db.videos.update(videoId, { ...patch, updatedAt: Date.now() });
}

export async function deleteVideo(videoId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.videos, db.videoTags, db.screenshots, db.clips],
    async () => {
      await db.videos.delete(videoId);
      await db.videoTags.where('videoId').equals(videoId).delete();
      await db.screenshots.where('videoId').equals(videoId).delete();
      await db.clips.where('videoId').equals(videoId).delete();
    },
  );
}

export async function listVideos(): Promise<Video[]> {
  return db.videos.orderBy('addedAt').reverse().toArray();
}
