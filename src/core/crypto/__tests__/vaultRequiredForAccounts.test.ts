import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { maybeEncrypt, setProfileLoaded } from '../cryptoHelpers';

// EA-16: если автосоздание сейфа при входе не удалось, maybeEncrypt раньше
// возвращал документ как есть — и заметки уходили в облако открытым текстом.
describe('maybeEncrypt: account without a vault (EA-16)', () => {
  const flag = globalThis as { __jwVaultOptionalForTests?: boolean | undefined };
  let saved: boolean | undefined;

  beforeEach(() => {
    saved = flag.__jwVaultOptionalForTests;
    flag.__jwVaultOptionalForTests = false; // как в проде
  });
  afterEach(() => {
    flag.__jwVaultOptionalForTests = saved;
  });

  it('refuses to hand out plaintext for a signed-in account with no vault', async () => {
    setProfileLoaded('user_no_vault', true);
    await expect(maybeEncrypt({ content: 'личный текст' }, ['content'], [], 'user_no_vault'))
      .rejects.toThrow(/ENCRYPT_REQUIRED: vault not set up/);
  });

  it('leaves guests alone — their notes never leave the device', async () => {
    await expect(maybeEncrypt({ content: 'текст' }, ['content'], [], 'guest_abc'))
      .resolves.toEqual({ content: 'текст' });
  });
});
