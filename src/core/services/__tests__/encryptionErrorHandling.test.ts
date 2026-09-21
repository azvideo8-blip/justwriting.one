import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unlockVault, WrongPasswordError } from '../EncryptionService';
import * as encryptionMetaService from '../EncryptionMetaService';
import * as reportErrorModule from '../../../shared/errors/reportError';

vi.mock('../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

describe('ERR-2: encryption error handling distinguishes wrong password from corrupted meta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws WrongPasswordError on OperationError (actual wrong password)', async () => {
    // Setup a vault with valid base64 and valid iterations
    const validMeta = {
      salt: 'c2FsdHNhbHRzYWx0c2FsdA==', // valid base64
      wrappedDataKey: 'd3JhcHBlZGRhdGFrZXk=', // valid base64 (will fail aes-gcm tag -> OperationError)
      version: 1,
      iterations: 1000,
    };
    vi.spyOn(encryptionMetaService, 'getEncryptionMeta').mockResolvedValue(validMeta as any);

    await expect(unlockVault('user1', 'any-password')).rejects.toThrow(WrongPasswordError);
    expect(reportErrorModule.reportError).not.toHaveBeenCalled();
  });

  it('does NOT throw WrongPasswordError on corrupted base64, reports error', async () => {
    // Corrupted base64 triggers InvalidCharacterError / TypeError, NOT OperationError
    const corruptedMeta = {
      salt: '!!!not-valid-base64!!!',
      wrappedDataKey: '!!!not-valid-base64!!!',
      version: 1,
      iterations: 1000,
    };
    vi.spyOn(encryptionMetaService, 'getEncryptionMeta').mockResolvedValue(corruptedMeta as any);

    await expect(unlockVault('user1', 'any-password')).rejects.not.toThrow(WrongPasswordError);
    expect(reportErrorModule.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'unlock_key_derivation', userId: 'user1' }),
    );
  });

  it('does NOT throw WrongPasswordError on NaN iterations, reports error', async () => {
    const nanMeta = {
      salt: 'c2FsdHNhbHRzYWx0c2FsdA==',
      wrappedDataKey: 'd3JhcHBlZGRhdGFrZXk=',
      version: 1,
      iterations: NaN,
    };
    vi.spyOn(encryptionMetaService, 'getEncryptionMeta').mockResolvedValue(nanMeta as any);

    await expect(unlockVault('user1', 'any-password')).rejects.not.toThrow(WrongPasswordError);
    expect(reportErrorModule.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'unlock_key_derivation', userId: 'user1' }),
    );
  });
});
