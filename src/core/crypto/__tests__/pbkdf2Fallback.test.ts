import { describe, it, expect } from 'vitest';
import {
  deriveMasterKey,
  wrapDataKey,
  generateDataKey,
  unwrapDataKeyWithPassword,
  PBKDF2_ITERATIONS,
  LEGACY_PBKDF2_ITERATIONS,
} from '../encrypt';

/**
 * SEC-36 raised PBKDF2 from 300k to 600k iterations but derived unconditionally
 * at the new count, so every vault wrapped at 300k stopped opening: the password
 * was right, the derived key was not, and the UI reported "wrong password".
 * Users were locked out of their own notes with no way to tell why.
 *
 * The fallback LOGIC is tested with deliberately cheap iteration counts — running
 * the real 600k here saturates the CPU and makes unrelated suites time out. The
 * real constants are asserted separately below, so both properties stay covered.
 */
const CURRENT = 2_000;
const LEGACY = 1_000;

describe('PBKDF2 iteration fallback (SEC-36 lockout)', () => {
  it('opens a vault wrapped at the legacy count', async () => {
    const password = 'correct horse battery staple';
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // A vault as it exists for anyone who set encryption up before the raise.
    const dataKey = await generateDataKey();
    const legacyMaster = await deriveMasterKey(password, salt, LEGACY);
    const wrapped = await wrapDataKey(dataKey, legacyMaster);

    const { usedLegacyIterations } = await unwrapDataKeyWithPassword(
      wrapped, password, salt, CURRENT, LEGACY,
    );
    expect(usedLegacyIterations).toBe(true);
  });

  it('opens a vault wrapped at the current count without falling back', async () => {
    const password = 'correct horse battery staple';
    const salt = crypto.getRandomValues(new Uint8Array(16));

    const dataKey = await generateDataKey();
    const currentMaster = await deriveMasterKey(password, salt, CURRENT);
    const wrapped = await wrapDataKey(dataKey, currentMaster);

    const { usedLegacyIterations } = await unwrapDataKeyWithPassword(
      wrapped, password, salt, CURRENT, LEGACY,
    );
    expect(usedLegacyIterations).toBe(false);
  });

  it('still rejects a genuinely wrong password at either count', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const dataKey = await generateDataKey();
    const master = await deriveMasterKey('the real password', salt, LEGACY);
    const wrapped = await wrapDataKey(dataKey, master);

    // The fallback must widen which iteration counts are accepted, never which
    // passwords are.
    await expect(
      unwrapDataKeyWithPassword(wrapped, 'not the password', salt, CURRENT, LEGACY),
    ).rejects.toThrow();
  });

  it('defaults to the real constants, so production unlock covers legacy vaults', () => {
    // Guards the pairing the logic tests above stub out: if these drift, vaults
    // wrapped by the shipped code stop matching what unlock tries.
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    expect(LEGACY_PBKDF2_ITERATIONS).toBe(300_000);
  });
});
