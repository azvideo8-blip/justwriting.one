// DY9-9 (дейлик 29.10, запуск 2, Н-1): кнопки админки «сбросить дневной лимит»
// звали resetUserLimit, а на VPS его не перенесли с Firebase — 404 «endpoint not
// found». Сбрасывает суточные счётчики чата и рассуждений человека за сегодня.
import { z } from 'zod';
import { AiError, type AiContext } from '../../src/shared/ai/context.js';

const inputSchema = z.object({
  targetUid: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
});

export async function resetUserLimitLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  if (!await ctx.isAdmin(uid)) {
    throw new AiError('permission-denied', 'Admin access required.');
  }
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) {
    throw new AiError('invalid-argument', 'Invalid arguments.');
  }
  await ctx.resetDailyLimit(parsed.data.targetUid);
  return { ok: true };
}
