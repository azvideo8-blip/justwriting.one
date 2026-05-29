import { getClient } from '../firebase/firestoreClient';
import { toBase64, fromBase64 } from '../crypto/encrypt';

export interface EncryptionMeta {
  salt: string;
  version: number;
  wrappedDataKey: string;
  verification: string;
}

const ENCRYPTION_META_VERSION = 1;
const VERIFICATION_PLAINTEXT = 'justwriting-verify-v1';

export { VERIFICATION_PLAINTEXT };

export async function saveEncryptionMeta(uid: string, meta: EncryptionMeta): Promise<void> {
  const { db, mod } = await getClient();
  const { doc, setDoc } = mod;
  await setDoc(doc(db, 'users', uid), {
    encryptionMeta: {
      salt: meta.salt,
      version: meta.version,
      wrappedDataKey: meta.wrappedDataKey,
      verification: meta.verification,
    },
  }, { merge: true });
}

export async function getEncryptionMeta(uid: string): Promise<EncryptionMeta | null> {
  const { db, mod } = await getClient();
  const { doc, getDoc } = mod;
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  const meta = data.encryptionMeta;
  if (!meta || typeof meta !== 'object') return null;
  if (!meta.salt || !meta.wrappedDataKey) return null;
  return {
    salt: meta.salt as string,
    version: (meta.version as number) ?? ENCRYPTION_META_VERSION,
    wrappedDataKey: meta.wrappedDataKey as string,
    verification: (meta.verification as string) ?? '',
  };
}

export async function hasEncryptionMeta(uid: string): Promise<boolean> {
  const meta = await getEncryptionMeta(uid);
  return meta !== null;
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export function saltToBase64(salt: Uint8Array): string {
  return toBase64(salt);
}

export function saltFromBase64(b64: string): Uint8Array {
  return fromBase64(b64);
}

export { ENCRYPTION_META_VERSION };
