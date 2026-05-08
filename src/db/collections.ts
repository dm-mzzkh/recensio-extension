import { db, type Collection, type Video } from './schema';

export async function createCollection(name: string, cover?: string): Promise<number> {
  const now = Date.now();
  return db.collections.add({ name: name.trim(), cover, createdAt: now, updatedAt: now });
}

export async function listCollections(): Promise<Collection[]> {
  return db.collections.orderBy('createdAt').toArray();
}

export async function renameCollection(id: number, name: string): Promise<void> {
  await db.collections.update(id, { name: name.trim(), updatedAt: Date.now() });
}

export async function deleteCollection(id: number): Promise<void> {
  await db.transaction('rw', db.collections, db.collectionItems, async () => {
    await db.collectionItems.where('collectionId').equals(id).delete();
    await db.collections.delete(id);
  });
}

export async function addToCollection(collectionId: number, videoId: string): Promise<void> {
  const exists = await db.collectionItems
    .where('[collectionId+videoId]')
    .equals([collectionId, videoId])
    .first();
  if (exists) return;
  const last = await db.collectionItems
    .where('collectionId')
    .equals(collectionId)
    .reverse()
    .sortBy('position');
  const position = last[0]?.position != null ? last[0].position + 1 : 0;
  await db.collectionItems.add({ collectionId, videoId, position });
}

export async function removeFromCollection(collectionId: number, videoId: string): Promise<void> {
  await db.collectionItems
    .where('[collectionId+videoId]')
    .equals([collectionId, videoId])
    .delete();
}

export async function getCollectionVideos(collectionId: number): Promise<Video[]> {
  const items = await db.collectionItems
    .where('collectionId')
    .equals(collectionId)
    .sortBy('position');
  if (!items.length) return [];
  const videos = await db.videos.bulkGet(items.map((i) => i.videoId));
  return videos.filter((v): v is Video => v != null);
}

export async function reorderCollection(
  collectionId: number,
  videoIdsInOrder: string[],
): Promise<void> {
  await db.transaction('rw', db.collectionItems, async () => {
    for (let i = 0; i < videoIdsInOrder.length; i++) {
      const item = await db.collectionItems
        .where('[collectionId+videoId]')
        .equals([collectionId, videoIdsInOrder[i]])
        .first();
      if (item?.id != null) {
        await db.collectionItems.update(item.id, { position: i });
      }
    }
  });
}
