// AUDIT-H6: cooldown между попытками удаления аккаунта — второй барьер после
// re-auth по amr. Проверяем окно и протухание.
import { describe, expect, it } from 'vitest';
import { acquireDeleteSlot } from '../account';

describe('acquireDeleteSlot', () => {
  it('allows the first attempt, blocks within the window, allows after it expires', () => {
    const t0 = 1_000_000_000;
    expect(acquireDeleteSlot('u_cool', t0)).toBe(true);
    expect(acquireDeleteSlot('u_cool', t0 + 1000)).toBe(false);
    // Чужой аккаунт не задет.
    expect(acquireDeleteSlot('u_other', t0 + 2000)).toBe(true);
    const hour = 60 * 60 * 1000;
    expect(acquireDeleteSlot('u_cool', t0 + hour - 1)).toBe(false);
    expect(acquireDeleteSlot('u_cool', t0 + hour)).toBe(true);
  });
});
