// User-facing backup toggles, persisted in browser.storage.local so the
// background page (auto-export alarm) and the library page (the toggle UI +
// restore banner) read the same source of truth. Both default to ON — the
// feature is opt-out, per product decision.

export interface BackupSettings {
  autoBackup: boolean;
  autoRestore: boolean;
}

const KEY = 'backupSettings';
const DEFAULTS: BackupSettings = { autoBackup: true, autoRestore: true };

export async function getBackupSettings(): Promise<BackupSettings> {
  const stored = (await browser.storage.local.get(KEY))[KEY] as
    | Partial<BackupSettings>
    | undefined;
  return { ...DEFAULTS, ...(stored ?? {}) };
}

export async function setBackupSettings(
  patch: Partial<BackupSettings>,
): Promise<BackupSettings> {
  const next = { ...(await getBackupSettings()), ...patch };
  await browser.storage.local.set({ [KEY]: next });
  return next;
}
