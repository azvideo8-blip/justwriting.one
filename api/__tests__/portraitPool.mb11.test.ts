import { describe, it, expect, vi } from 'vitest';
import { chatWithAILogic } from '../ai/chatWithAI.logic';
import type { AiContext } from '../../src/shared/ai/context.js';
import { SYSTEM_TASK_PROMPTS } from '../../src/shared/ai/systemTaskPrompts.js';
import { chatInputSchema } from '../../src/shared/ai/buildChatPrompt.js';

// MB-11 (N-6): разделы портрета при «Обновить профиль» уходят с `callType:
// 'system_task'` и `charge: 'user'` (callAi кладёт его в тело). Обработчик чата
// `charge` не читает: служебный вызов списывается из пула `internal_chat`, квота
// чата человека не трогается. Оценка и комментарий в AIProfileRefreshService
// приведены к этому.
vi.mock('../ai/provider', () => ({
  generate: vi.fn().mockResolvedValue({ text: 'ok', tokensIn: 10, tokensOut: 10, model: 'test-model' }),
  getActiveModel: vi.fn().mockResolvedValue('test-model'),
}));

describe('MB-11: из какого пула списывается портрет', () => {
  it('system_task с charge: user — пул internal_chat, квота чата не трогается', async () => {
    const ctx = {
      checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-22' }),
      refundDailyLimit: vi.fn().mockResolvedValue(undefined),
      checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-22' }),
      refundBulkLimit: vi.fn().mockResolvedValue(undefined),
      tryReserveGlobalRequest: vi.fn().mockResolvedValue({ id: 'res_1' }),
      refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
      recordUsage: vi.fn().mockResolvedValue(undefined),
      recordDailySpendRub: vi.fn().mockResolvedValue(undefined),
    } as unknown as AiContext;

    await chatWithAILogic(ctx, 'u_portrait', {
      callType: 'system_task',
      personaId: 'custom',
      customSystemPrompt: SYSTEM_TASK_PROMPTS.profileThemes,
      messages: [{ role: 'user', content: 'Темы и интересы на основе данных:\n\nработа, бег' }],
      charge: 'user',
    });

    expect(ctx.checkAndIncrementBulkLimit).toHaveBeenCalledWith('u_portrait', 'chat', 'internal_chat');
    expect(ctx.checkAndIncrementLimit).not.toHaveBeenCalled();
  });

  // Промпты разделов длиннее 500 знаков: при общем потолке схема отклоняла каждый
  // раздел до модели, портрет не пересобирался с сентября.
  it.each(['profileThemes', 'profileEmotionalPatterns', 'profileStrengths', 'profileGrowth', 'profileCommunication'] as const)(
    'раздел %s проходит схему ввода',
    (key) => {
      const r = chatInputSchema.safeParse({
        callType: 'system_task', personaId: 'custom', customSystemPrompt: SYSTEM_TASK_PROMPTS[key],
        messages: [{ role: 'user', content: 'данные' }],
      });
      expect(r.success).toBe(true);
    },
  );

  it('свой промпт человека по-прежнему не длиннее 500', () => {
    const r = chatInputSchema.safeParse({
      personaId: 'custom', customSystemPrompt: 'я'.repeat(501), messages: [{ role: 'user', content: 'привет' }],
    });
    expect(r.success).toBe(false);
  });
});
