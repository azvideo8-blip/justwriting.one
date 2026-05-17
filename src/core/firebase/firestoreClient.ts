import { getDb } from './firestore';

type Firestore = import('firebase/firestore').Firestore;

let _cached: {
  db: Firestore;
  mod: typeof import('firebase/firestore');
} | null = null;
let _initPromise: Promise<typeof _cached> | null = null;

async function init() {
  if (_cached) return _cached;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const [mod, db] = await Promise.all([import('firebase/firestore'), getDb()]);
    _cached = { db, mod };
    return _cached;
  })();
  return _initPromise;
}

export async function getClient() {
  return init();
}
