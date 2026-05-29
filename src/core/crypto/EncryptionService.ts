import { encryptAllExistingNotes, type MigrationProgress } from './encryptMigration';
import { WrongPasswordError, unlockVault as newUnlockVault, initializeEncryption as newInitializeEncryption, lockVault as newLockVault, changePassword as newChangePassword } from '../services/EncryptionService';

async function encryptAll(userId: string, onProgress: (p: MigrationProgress) => void, signal: AbortSignal) {
  const { getSessionKey } = await import('./encrypt');
  if (!getSessionKey()) throw new Error('Vault is locked');
  return encryptAllExistingNotes(userId, onProgress, signal);
}

export const EncryptionService = {
  unlockVault: newUnlockVault,
  initializeEncryption: newInitializeEncryption,
  lockVault: newLockVault,
  changePassword: newChangePassword,
  encryptAll,
  WrongPasswordError,
};

export { WrongPasswordError };
