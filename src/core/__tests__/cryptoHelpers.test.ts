import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  maybeEncrypt,
  setEncryptionEnabled,
  getEncryptionEnabled
} from '../crypto/cryptoHelpers';
import { getSessionKey, encryptContent } from '../crypto/encrypt';

vi.mock('../crypto/encrypt', () => {
  return {
    getSessionKey: vi.fn(),
    encryptContent: vi.fn(async (val) => `enc_${val}`),
    decryptContent: vi.fn(async (val) => val.replace('enc_', '')),
  };
});

describe('cryptoHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles getEncryptionEnabled / setEncryptionEnabled caching', () => {
    setEncryptionEnabled('user1', true);
    expect(getEncryptionEnabled('user1')).toBe(true);

    setEncryptionEnabled('user1', false);
    expect(getEncryptionEnabled('user1')).toBe(false);
  });

  it('maybeEncrypt bypasses encryption when disabled for user', async () => {
    setEncryptionEnabled('user-no-enc', false);
    const doc = { content: 'hello' };
    const res = await maybeEncrypt(doc, ['content'], [], 'user-no-enc');
    expect(res).toEqual({ content: 'hello' });
    expect(encryptContent).not.toHaveBeenCalled();
  });

  it('maybeEncrypt requires encryption when enabled for user and session key missing', async () => {
    setEncryptionEnabled('user-enc', true);
    vi.mocked(getSessionKey).mockReturnValue(null);
    const doc = { content: 'hello' };
    await expect(maybeEncrypt(doc, ['content'], [], 'user-enc')).rejects.toThrow('ENCRYPT_REQUIRED');
  });

  it('maybeEncrypt encrypts when enabled for user and session key exists', async () => {
    setEncryptionEnabled('user-enc', true);
    const dummyKey = {} as any;
    vi.mocked(getSessionKey).mockReturnValue(dummyKey);
    const doc = { content: 'hello' };
    const res = await maybeEncrypt(doc, ['content'], [], 'user-enc');
    expect(res._encrypted).toBe(true);
    expect(res.content).toBe('enc_hello');
    expect(encryptContent).toHaveBeenCalledWith('hello', dummyKey);
  });
});
