import { describe, it, expect, beforeEach } from 'vitest';
import { generateDataKey, setSessionKey, clearSessionKey, encryptContent } from '../encrypt';
import { maybeDecrypt, maybeEncrypt, setEncryptionEnabled, setProfileLoaded } from '../cryptoHelpers';

// R3-4: хеш текста сводки теперь шифруется; строки до 0.9.2 хранят его открытым —
// их нужно читать, а не объявлять нечитаемыми.
describe('R3-4: contentHash is encrypted on write and read tolerantly on legacy rows', () => {
  const uid = 'u_hash';
  beforeEach(async () => {
    clearSessionKey();
    setProfileLoaded(uid, true);
    setEncryptionEnabled(uid, true);
    setSessionKey(await generateDataKey());
  });

  it('keeps a legacy plaintext hash readable on an encrypted row', async () => {
    const hex = 'a'.repeat(64);
    const key = (await import('../encrypt')).getSessionKey()!;
    const row = { _encrypted: true, summary: await encryptContent('сводка', key), contentHash: hex };
    const out = await maybeDecrypt(row, ['summary', 'contentHash'], []);
    expect(out.contentHash).toBe(hex);
    expect(out.summary).toBe('сводка');
  });

  it('writes the hash encrypted', async () => {
    const hex = 'b'.repeat(64);
    const enc = await maybeEncrypt({ contentHash: hex }, ['contentHash'], [], uid);
    expect(enc.contentHash).not.toBe(hex);
    const back = await maybeDecrypt(enc, ['contentHash'], []);
    expect(back.contentHash).toBe(hex);
  });
});
