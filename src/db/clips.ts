import { db, type Clip } from './schema';

export type NewClip = Omit<Clip, 'id' | 'createdAt' | 'updatedAt'>;
export type ClipUpdate = Partial<
  Pick<
    Clip,
    | 'title'
    | 'note'
    | 'startSec'
    | 'endSec'
    | 'blob'
    | 'mimeType'
    | 'width'
    | 'height'
    | 'status'
    | 'errorMsg'
    | 'stage'
  >
>;

export async function addClip(c: NewClip): Promise<number> {
  const now = Date.now();
  return db.clips.add({ ...c, createdAt: now, updatedAt: now });
}

export async function listClips(videoId: string): Promise<Clip[]> {
  return db.clips.where('videoId').equals(videoId).sortBy('startSec');
}

export async function updateClip(id: number, patch: ClipUpdate): Promise<void> {
  await db.clips.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteClip(id: number): Promise<void> {
  await db.clips.delete(id);
}
