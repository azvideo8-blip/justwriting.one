import { getDb } from './firestore';

type Firestore = import('firebase/firestore').Firestore;

type Client = {
  db: Firestore;
  mod: typeof import('firebase/firestore');
};

let _cached: Client | null = null;
let _initPromise: Promise<Client> | null = null;

async function init(): Promise<Client> {
  if (_cached) return _cached;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const [mod, db] = await Promise.all([import('firebase/firestore'), getDb()]);
    _cached = { db, mod };
    return _cached;
  })();
  // Reset on failure so a transient error doesn't permanently kill cloud sync.
  try {
    return await _initPromise;
  } catch (e) {
    _initPromise = null;
    throw e;
  }
}

export async function getClient(): Promise<Client> {
  return init();
}
