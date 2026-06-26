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
  const { doc, setDoc, deleteField } = mod;
  await setDoc(doc(db, 'users', uid), {
    encryptionMeta: {
      salt: meta.salt,
      version: meta.version,
      wrappedDataKey: meta.wrappedDataKey,
      verification: meta.verification,
    },
    // Clean up legacy fields if they exist
    encryptionSalt: deleteField(),
    encryptedDataKey: deleteField(),
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
  const salt = String(meta.salt);
  const wrappedDataKey = String(meta.wrappedDataKey);
  const verification = typeof meta.verification === 'string' ? meta.verification : '';
  const version = typeof meta.version === 'number' ? meta.version : ENCRYPTION_META_VERSION;
  return {
    salt,
    version,
    wrappedDataKey,
    verification,
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
