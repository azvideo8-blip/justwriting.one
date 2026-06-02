import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  maybeEncrypt,
  maybeDecrypt,
  setEncryptionEnabled,
  getEncryptionEnabled,
  setProfileLoaded,
  isProfileLoaded,
  DecryptionError,
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
    const dummyKey = {} as CryptoKey;
    vi.mocked(getSessionKey).mockReturnValue(dummyKey);
    const doc = { content: 'hello' };
    const res = await maybeEncrypt(doc, ['content'], [], 'user-enc');
    expect(res._encrypted).toBe(true);
    expect(res.content).toBe('enc_hello');
    expect(encryptContent).toHaveBeenCalledWith('hello', dummyKey);
  });

  it('maybeEncrypt encrypts array fields as JSON strings', async () => {
    setEncryptionEnabled('user-enc', true);
    const dummyKey = {} as CryptoKey;
    vi.mocked(getSessionKey).mockReturnValue(dummyKey);
    const doc = { content: 'hello', tags: ['a', 'b'] };
    const res = await maybeEncrypt(doc, ['content'], ['tags'], 'user-enc');
    expect(res._encrypted).toBe(true);
    expect(res.tags).toBe('enc_["a","b"]');
  });

  it('maybeEncrypt handles required=true boolean without userId', async () => {
    vi.mocked(getSessionKey).mockReturnValue(null);
    const doc = { content: 'hello' };
    await expect(maybeEncrypt(doc, ['content'], [], true)).rejects.toThrow('ENCRYPT_REQUIRED');
  });

  it('maybeDecrypt returns unencrypted doc when _encrypted is false', async () => {
    const doc = { content: 'hello', pinnedThoughts: '[]' };
    const res = await maybeDecrypt(doc, ['content'], ['pinnedThoughts']);
    expect(res.content).toBe('hello');
    expect(res.pinnedThoughts).toEqual([]);
  });

  it('maybeDecrypt decrypts string fields when _encrypted and key present', async () => {
    const dummyKey = {} as CryptoKey;
    vi.mocked(getSessionKey).mockReturnValue(dummyKey);
    const doc = { content: 'enc_hello', _encrypted: true };
    const res = await maybeDecrypt(doc, ['content'], []);
    expect(res.content).toBe('hello');
  });

  it('maybeDecrypt decrypts array fields and parses JSON when _encrypted', async () => {
    const dummyKey = {} as CryptoKey;
    vi.mocked(getSessionKey).mockReturnValue(dummyKey);
    const doc = { pinnedThoughts: 'enc_["a","b"]', _encrypted: true };
    const res = await maybeDecrypt(doc, [], ['pinnedThoughts']);
    expect(res.pinnedThoughts).toEqual(['a', 'b']);
  });

  it('maybeDecrypt throws DecryptionError when string field fails to decrypt', async () => {
    const dummyKey = {} as CryptoKey;
    vi.mocked(getSessionKey).mockReturnValue(dummyKey);
    const { decryptContent } = await import('../crypto/encrypt');
    vi.mocked(decryptContent).mockRejectedValueOnce(new Error('bad key'));
    const doc = { content: 'enc_xxx', _encrypted: true };
    await expect(maybeDecrypt(doc, ['content'], [])).rejects.toThrow(DecryptionError);
  });

  it('maybeDecrypt throws LOCKED when _encrypted and key missing', async () => {
    vi.mocked(getSessionKey).mockReturnValue(null);
    const doc = { content: 'enc_hello', _encrypted: true };
    await expect(maybeDecrypt(doc, ['content'], [])).rejects.toThrow('LOCKED');
  });

  it('maybeDecrypt defaults array field to empty array on JSON parse error', async () => {
    const doc = { pinnedThoughts: 'not-json', _encrypted: false };
    const res = await maybeDecrypt(doc, [], ['pinnedThoughts']);
    expect(res.pinnedThoughts).toEqual([]);
  });

  it('maybeDecrypt defaults array field to empty array when value is not string or array', async () => {
    const doc = { pinnedThoughts: 123, _encrypted: false };
    const res = await maybeDecrypt(doc, [], ['pinnedThoughts']);
    expect(res.pinnedThoughts).toEqual([]);
  });

  it('setProfileLoaded / isProfileLoaded caching', () => {
    setProfileLoaded('user1', true);
    expect(isProfileLoaded('user1')).toBe(true);
    setProfileLoaded('user1', false);
    expect(isProfileLoaded('user1')).toBe(false);
  });

  it('DecryptionError has correct name and message', () => {
    const err = new DecryptionError('content', new Error('cause'));
    expect(err.name).toBe('DecryptionError');
    expect(err.message).toBe('DECRYPTION_FAILED: "content"');
    expect(err.cause).toBeInstanceOf(Error);
  });
});
