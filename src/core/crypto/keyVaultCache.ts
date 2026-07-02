// "Remember on this device": persist the (non-extractable) data CryptoKey in a
// dedicated IndexedDB so the vault auto-unlocks on reload without re-entering the
// passphrase. Separate DB (not the main app DB) to avoid a schema-version bump.
// Opt-in only — default behavior (prompt every reload) is preserved for those who
// want maximum at-rest security. Web Crypto keys are structured-cloneable.
const DB_NAME = 'jw-keycache';
const STORE = 'keys';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function secureClear(buf: Uint8Array): void {
  buf.fill(0);
}

export async function saveDeviceKey(userId: string, key: CryptoKey): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    let keyToStore = key;
    if (key.extractable) {
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
      try {
        keyToStore = await crypto.subtle.importKey(
          'raw',
          raw,
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt'],
        );
      } finally {
        secureClear(raw);
      }
    }
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(keyToStore, userId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* non-critical */ } finally {
    db?.close();
  }
}

export async function loadDeviceKey(userId: string): Promise<CryptoKey | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const key = await new Promise<unknown>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(userId);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return key instanceof CryptoKey ? key : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function clearDeviceKey(userId?: string): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      if (userId) store.delete(userId); else store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* non-critical */ } finally {
    db?.close();
  }
}
