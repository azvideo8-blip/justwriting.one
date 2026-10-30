// DY9-9 (дейлик 29.10, запуск 2, Н-1): кнопки админки «сбросить дневной лимит»
// звали resetUserLimit, а на VPS его не перенесли с Firebase — 404 «endpoint not
// found». Сбрасывает суточные счётчики чата и рассуждений человека за сегодня.
import { z } from 'zod';
import { AiError, type AiContext } from '../../src/shared/ai/context.js';

const inputSchema = z.object({
  // DY10-1: target_uid в admin_actions — uuid.
  targetUid: z.string().uuid(),
});

export async function resetUserLimitLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  if (!await ctx.isAdmin(uid)) {
    throw new AiError('permission-denied', 'Admin access required.');
  }
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) {
    throw new AiError('invalid-argument', 'Invalid arguments.');
  }
  // DY10-1: след в admin_actions и бюджет — внутри resetDailyLimit, одной транзакцией.
  const verdict = await ctx.resetDailyLimit(uid, parsed.data.targetUid);
  if (verdict === 'budget') throw new AiError('resource-exhausted', 'Не больше 20 сбросов лимита в час. Повторите позже.');
  if (verdict === 'busy') throw new AiError('resource-exhausted', 'Сброс уже выполняется. Повторите через минуту.');
  return { ok: true };
}
