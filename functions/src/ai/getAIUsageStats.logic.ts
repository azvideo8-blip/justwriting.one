// functions/src/ai/getAIUsageStats.logic.ts
// NOTE: This handler is Firestore-only (admin stats query).
// On VPS it returns a stub response; the production Cloud Function is the real impl.
import { z } from 'zod';
import { TIER_LIMITS, DAILY_LIMIT } from '../shared/aiUtils';
import { AiError, type AiContext } from '../shared/aiContext';

const inputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(val => {
    const [, m, d] = val.split('-').map(Number);
    return (m ?? 0) >= 1 && (m ?? 0) <= 12 && (d ?? 0) >= 1 && (d ?? 0) <= 31;
  }, 'Invalid date: month must be 1-12, day must be 1-31'),
  targetUid: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).optional(),
});

export async function getAIUsageStatsLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const isAdmin = await ctx.isAdmin(uid);
  if (!isAdmin) {
    throw new AiError('permission-denied', 'Admin access required.');
  }

  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) {
    throw new AiError('invalid-argument', 'Invalid arguments.');
  }

  const { date, targetUid } = parsed.data;

  // On VPS there's no Firestore collection to query — return usage from Postgres.
  if (targetUid) {
    const { used } = await ctx.getDailyLimitCount(targetUid);
    return { events: [{ id: 'vps-stub', ts: 0, tokensIn: 0, tokensOut: 0, model: 'unknown', fn: 'unknown', date, used }] };
  }

  return {
    stats: [],
    totals: { requests: 0, promptTokens: 0, completionTokens: 0 },
    limits: { ...TIER_LIMITS, perUserDaily: DAILY_LIMIT },
  };
}
