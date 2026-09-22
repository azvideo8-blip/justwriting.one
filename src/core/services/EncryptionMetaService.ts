import { DataProvider } from '../data';
import { toBase64, fromBase64 } from '../crypto/encrypt';

export interface EncryptionMeta {
  salt: string;
  version: number;
  wrappedDataKey: string;
  verification: string;
  recoveryWrappedDataKey?: string | undefined;
  recoverySalt?: string | undefined;
  /** AUDIT-L7: PBKDF2-итерации при wrap; отсутствует у старых сейфов. */
  iterations?: number | undefined;
  /** Сейф создан автоматически от пароля аккаунта при первом входе */
  autoCreated?: boolean | undefined;
}

const ENCRYPTION_META_VERSION = 2;
const VERIFICATION_PLAINTEXT = 'justwriting-verify-v1';

export { VERIFICATION_PLAINTEXT };

export async function saveEncryptionMeta(uid: string, meta: EncryptionMeta): Promise<void> {
  const encryptionMeta: Record<string, unknown> = {
    salt: meta.salt,
    version: meta.version,
    wrappedDataKey: meta.wrappedDataKey,
    verification: meta.verification,
  };
  if (meta.recoveryWrappedDataKey) {
    encryptionMeta.recoveryWrappedDataKey = meta.recoveryWrappedDataKey;
  }
  if (meta.recoverySalt) {
    encryptionMeta.recoverySalt = meta.recoverySalt;
  }
  if (meta.iterations !== undefined) {
    encryptionMeta.iterations = meta.iterations;
  }
  if (meta.autoCreated !== undefined) {
    encryptionMeta.autoCreated = meta.autoCreated;
  }
  await DataProvider.saveEncryptionMeta(uid, {
    encryptionMeta: encryptionMeta as unknown as EncryptionMeta,
  });
}

export async function getEncryptionMeta(uid: string): Promise<EncryptionMeta | null> {
  const data = await DataProvider.getEncryptionMeta(uid);
  if (!data) return null;
  const rawMeta = data.encryptionMeta;
  if (!rawMeta || typeof rawMeta !== 'object') return null;
  const meta = rawMeta as Record<string, unknown>;
  if (!meta.salt || !meta.wrappedDataKey) return null;
  const salt = String(meta.salt);
  const wrappedDataKey = String(meta.wrappedDataKey);
  const verification = typeof meta.verification === 'string' ? meta.verification : '';
  const version = typeof meta.version === 'number' ? meta.version : 1;
  const recoveryWrappedDataKey = typeof meta.recoveryWrappedDataKey === 'string' ? meta.recoveryWrappedDataKey : undefined;
  const recoverySalt = typeof meta.recoverySalt === 'string' ? meta.recoverySalt : undefined;
  const iterations = typeof meta.iterations === 'number' && Number.isFinite(meta.iterations) && meta.iterations > 0
    ? meta.iterations
    : undefined;
  const autoCreated = meta.autoCreated === true;
  return {
    salt,
    version,
    wrappedDataKey,
    verification,
    recoveryWrappedDataKey,
    recoverySalt,
    iterations,
    autoCreated,
  };
}

export async function hasEncryptionMeta(uid: string): Promise<boolean> {
  const meta = await getEncryptionMeta(uid);
  return meta !== null;
}

export function generateSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(16));
}

export function saltToBase64(salt: Uint8Array): string {
  return toBase64(salt);
}

export function saltFromBase64(b64: string): Uint8Array<ArrayBuffer> {
  return fromBase64(b64);
}

export { ENCRYPTION_META_VERSION };
