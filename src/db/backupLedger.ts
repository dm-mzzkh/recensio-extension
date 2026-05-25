import { db } from './schema';

export async function getLedgerKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  await db.backupLedger.each((row) => {
    keys.add(row.blobKey);
  });
  return keys;
}

export async function addLedgerEntries(blobKeys: string[]): Promise<void> {
  if (!blobKeys.length) return;
  const now = Date.now();
  // `&blobKey` is unique — bulkPut by key conflicts on add; insert one at a
  // time with `put` semantics through a transaction so re-running an export
  // after a partial failure is idempotent.
  await db.transaction('rw', db.backupLedger, async () => {
    for (const blobKey of blobKeys) {
      const existing = await db.backupLedger.where('blobKey').equals(blobKey).first();
      if (existing) continue;
      await db.backupLedger.add({ blobKey, exportedAt: now });
    }
  });
}

export async function clearLedger(): Promise<void> {
  await db.backupLedger.clear();
}
