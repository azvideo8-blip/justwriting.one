import { describe, it, expect, vi } from 'vitest';

// AUDIT-part3 3: /api/getAiQuota — источник истины по дневной квоте.

const ctx = {
  getDailyLimitCount: vi.fn(),
  isAdmin: vi.fn(),
};

vi.mock('../../src/shared/ai/context.js', () => ({
  AiError: class AiError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

vi.mock('../ai/pure', () => ({
  DAILY_LIMIT: 30,
  ADMIN_DAILY_LIMIT: 60,
}));

import { getAiQuotaLogic } from '../ai/getAiQuota.logic';

describe('getAiQuota.logic (AUDIT-part3 3)', () => {
  it('returns used/limit for a regular user', async () => {
    vi.mocked(ctx.getDailyLimitCount).mockResolvedValue({ used: 7, date: '2026-08-25' });
    vi.mocked(ctx.isAdmin).mockResolvedValue(false);

    const out = await getAiQuotaLogic(ctx as never, 'u1', {}) as { used: number; limit: number };
    expect(out.used).toBe(7);
    expect(out.limit).toBe(30);
    expect(ctx.getDailyLimitCount).toHaveBeenCalledWith('u1');
  });

  it('returns the admin ceiling for admins', async () => {
    vi.mocked(ctx.getDailyLimitCount).mockResolvedValue({ used: 0, date: '2026-08-25' });
    vi.mocked(ctx.isAdmin).mockResolvedValue(true);

    const out = await getAiQuotaLogic(ctx as never, 'admin', {}) as { limit: number };
    expect(out.limit).toBe(60);
  });

  it('rejects non-admin impersonation of another uid target — reads self only', async () => {
    // Эндпоинт не принимает targetUid: чужой счётчик прочитать невозможно.
    vi.mocked(ctx.getDailyLimitCount).mockResolvedValue({ used: 0, date: '2026-08-25' });
    vi.mocked(ctx.isAdmin).mockResolvedValue(false);
    const out = await getAiQuotaLogic(ctx as never, 'u1', { targetUid: 'someone-else' }) as { used: number };
    expect(ctx.getDailyLimitCount).toHaveBeenCalledWith('u1');
    expect(out.used).toBe(0);
  });

  it('returns both chat and reasoning numbers when both are present', async () => {
    vi.mocked(ctx.getDailyLimitCount).mockResolvedValue({ used: 5, reasoningUsed: 2, date: '2026-08-25' });
    vi.mocked(ctx.isAdmin).mockResolvedValue(false);

    const out = await getAiQuotaLogic(ctx as never, 'u1', {}) as {
      used: number;
      limit: number;
      reasoningUsed: number;
      reasoningLimit: number;
    };
    expect(out.used).toBe(5);
    expect(out.limit).toBe(30);
    expect(out.reasoningUsed).toBe(2);
    expect(out.reasoningLimit).toBe(5);
  });
});
