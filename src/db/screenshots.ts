import { db, type Screenshot } from './schema';

export type NewScreenshot = Omit<Screenshot, 'id' | 'createdAt'>;

export async function addScreenshot(s: NewScreenshot): Promise<number> {
  return db.screenshots.add({ ...s, createdAt: Date.now() });
}

export async function listScreenshots(videoId: string): Promise<Screenshot[]> {
  return db.screenshots.where('videoId').equals(videoId).sortBy('createdAt');
}

export async function deleteScreenshot(id: number): Promise<void> {
  await db.screenshots.delete(id);
}
