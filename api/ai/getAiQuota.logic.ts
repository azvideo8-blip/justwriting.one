import { z } from 'zod';
import { DAILY_LIMIT, ADMIN_DAILY_LIMIT } from './pure';
import { AiError, type AiContext } from '../../src/shared/ai/context.js';

// AUDIT-part3 3: источник истины по дневной квоте для САМОГО пользователя.
// До этого клиент считал вызовы локально (localStorage) и никогда не
// сверялся с сервером — счётчик расходился после restore/второй вкладки.
// getAIUsageStats не подходит: он admin-only.
// Лимиты берутся из pure.ts, не из env напрямую: один источник с
// checkDailyLimit, иначе клиентская заглушка и сервер разойдутся.

const inputSchema = z.object({}).passthrough();

export async function getAiQuotaLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  if (!inputSchema.safeParse(data ?? {}).success) {
    throw new AiError('invalid-argument', 'Invalid arguments.');
  }
  const { used } = await ctx.getDailyLimitCount(uid);
  const isAdmin = await ctx.isAdmin(uid);
  return {
    used,
    limit: isAdmin ? ADMIN_DAILY_LIMIT : DAILY_LIMIT,
    date: new Date().toISOString().slice(0, 10),
  };
}
