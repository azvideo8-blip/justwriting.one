export interface StorageEstimateInfo {
  usageBytes: number;
  quotaBytes: number;
  usageFormatted: string;
  quotaFormatted: string;
}

export interface StoragePersistenceStatus {
  supported: boolean;
  persisted: boolean;
  estimate: StorageEstimateInfo | null;
}

const STORAGE_PERSIST_KEY = 'storage_persist_requested';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function getStorage(): StorageManager | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as { storage?: StorageManager };
  return nav.storage !== undefined ? nav.storage : null;
}

export async function requestPersistentStorageOnce(): Promise<boolean> {
  const storage = getStorage();
  if (storage === null || typeof storage.persist !== 'function') {
    return false;
  }
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_PERSIST_KEY) !== null) {
      if (typeof storage.persisted === 'function') {
        return await storage.persisted();
      }
      return false;
    }
    const persisted = await storage.persist();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_PERSIST_KEY, 'true');
    }
    return persisted;
  } catch {
    return false;
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  const storage = getStorage();
  if (storage === null || typeof storage.persist !== 'function') {
    return false;
  }
  try {
    const persisted = await storage.persist();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_PERSIST_KEY, 'true');
    }
    return persisted;
  } catch {
    return false;
  }
}

export async function getStoragePersistenceStatus(): Promise<StoragePersistenceStatus> {
  const storage = getStorage();
  if (storage === null) {
    return { supported: false, persisted: false, estimate: null };
  }

  let persisted = false;
  try {
    if (typeof storage.persisted === 'function') {
      persisted = await storage.persisted();
    }
  } catch {
    persisted = false;
  }

  let estimate: StorageEstimateInfo | null = null;
  try {
    if (typeof storage.estimate === 'function') {
      const est = await storage.estimate();
      const usage = est.usage ?? 0;
      const quota = est.quota ?? 0;
      estimate = {
        usageBytes: usage,
        quotaBytes: quota,
        usageFormatted: formatBytes(usage),
        quotaFormatted: formatBytes(quota),
      };
    }
  } catch {
    estimate = null;
  }

  const supported = typeof storage.persist === 'function' || typeof storage.estimate === 'function';

  return {
    supported,
    persisted,
    estimate,
  };
}
