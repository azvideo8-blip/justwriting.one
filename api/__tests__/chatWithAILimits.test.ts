import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatWithAILogic } from '../ai/chatWithAI.logic';
import { generate } from '../ai/provider';
import type { AiContext } from '../../src/shared/ai/context.js';
import { SYSTEM_TASK_PROMPTS } from '../../src/shared/ai/systemTaskPrompts.js';
import { REASONING_LANGUAGE_RULE } from '../../src/shared/ai/buildChatPrompt.js';
import { ANSWER_CUT_NOTE, ANSWER_CUT_NOTE_EN } from '../../src/shared/ai/aiPolicy.js';

vi.mock('../ai/provider', () => ({
  generate: vi.fn(),
  getActiveModel: vi.fn().mockResolvedValue('test-model'),
}));

/**
 * `callType` приходит от клиента. Раньше он снимал и дневной лимит, и задержку
 * между запросами: один пользователь мог в цикле выжечь общий суточный лимит
 * приложения. Внутренние вызовы обязаны идти в свой счётчик, а не мимо всех.
 */
function ctxSpy() {
  return {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-22' }),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-22' }),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue({ id: 'res_1' }),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    recordDailySpendRub: vi.fn().mockResolvedValue(undefined),
  } as unknown as AiContext & {
    checkAndIncrementLimit: ReturnType<typeof vi.fn>;
    refundDailyLimit: ReturnType<typeof vi.fn>;
    checkAndIncrementBulkLimit: ReturnType<typeof vi.fn>;
    refundBulkLimit: ReturnType<typeof vi.fn>;
    tryReserveGlobalRequest: ReturnType<typeof vi.fn>;
    refundGlobalRequest: ReturnType<typeof vi.fn>;
  };
}

const payload = (extra: Record<string, unknown> = {}) => ({
  personaId: 'coach',
  messages: [{ role: 'user', content: 'привет' }],
  ...extra,
});

describe('chatWithAI: callType не обходит лимиты', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generate).mockResolvedValue({ text: 'ответ', tokensIn: 10, tokensOut: 10, model: 'test-model' });
  });

  it('внутренний вызов списывает bulk-счётчик, а не проходит мимо', async () => {
    const ctx = ctxSpy();
    await chatWithAILogic(ctx, 'user_1', payload({ callType: 'auto_name' }));
    expect(ctx.checkAndIncrementBulkLimit).toHaveBeenCalledWith('user_1', 'chat', 'internal_chat');
    expect(ctx.checkAndIncrementLimit).not.toHaveBeenCalled();
  });

  it('внутренний вызов отклоняется, когда bulk-счётчик исчерпан', async () => {
    const ctx = ctxSpy();
    ctx.checkAndIncrementBulkLimit.mockResolvedValue({ ok: false, day: '2026-08-22' });
    await expect(chatWithAILogic(ctx, 'user_1', payload({ callType: 'auto_name' })))
      .rejects.toMatchObject({ message: 'Daily limit reached.' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('обычный вызов по-прежнему идёт в дневной счётчик', async () => {
    const ctx = ctxSpy();
    await chatWithAILogic(ctx, 'user_1', payload());
    expect(ctx.checkAndIncrementLimit).toHaveBeenCalledWith('user_1', false);
    expect(ctx.checkAndIncrementBulkLimit).not.toHaveBeenCalled();
  });

  it('исчерпанный общий лимит возвращает bulk-списание внутреннему вызову', async () => {
    const ctx = ctxSpy();
    ctx.tryReserveGlobalRequest.mockResolvedValue(null);
    await expect(chatWithAILogic(ctx, 'user_1', payload({ callType: 'auto_name' }))).rejects.toThrow();
    expect(ctx.refundBulkLimit).toHaveBeenCalledWith('user_1', expect.any(String), 'internal_chat');
    expect(ctx.refundDailyLimit).not.toHaveBeenCalled();
  });

  it('PROMPT-1: system_task разрешает custom persona, до 12 сообщений и использует короткий системный промпт', async () => {
    const ctx = ctxSpy();
    const msgs = Array.from({ length: 10 }, (_, i) => ({ role: 'user' as const, content: `сообщение ${i}` }));
    await chatWithAILogic(ctx, 'user_1', {
      personaId: 'custom',
      callType: 'system_task',
      customSystemPrompt: SYSTEM_TASK_PROMPTS.dialogueSummary, // EA-1: только из белого списка
      messages: msgs,
    });

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      system: `Ты — служебная функция приложения для дневника. Выполни ровно то, что просят, без пояснений.\n\n${SYSTEM_TASK_PROMPTS.dialogueSummary}`,
      maxTokens: 2048,
    }));
  });

  it('PROMPT-1: обычный internal call (auto_name) получает однострочный системный промпт без гайдов', async () => {
    const ctx = ctxSpy();
    await chatWithAILogic(ctx, 'user_1', payload({ callType: 'auto_name' }));

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      system: 'Ты — служебная функция приложения для дневника. Выполни ровно то, что просят, без пояснений.',
      maxTokens: 256,
    }));
  });
});

// Запасной (непотоковый) путь режима рассуждений: раньше выключал встроенное
// рассуждение модели и просил писать «ХОД МЫСЛИ» прямо в ответе, а потоковый
// путь делал наоборот. Теперь оба включают рассуждение у провайдера и
// одинаково оформляют ответ.
describe('chatWithAI: режим рассуждений в запасном пути', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('включает рассуждение у провайдера, держит правило о языке и оформляет ответ как поток', async () => {
    vi.mocked(generate).mockResolvedValue({ text: 'Ответ.', reasoning: 'Размышляю.', tokensIn: 10, tokensOut: 10, model: 'test-model' });
    const res = await chatWithAILogic(ctxSpy(), 'user_1', payload({ reasoning: true }));
    const call = vi.mocked(generate).mock.calls[0]![0];
    expect(call.reasoningEffort).toBe('low');
    expect(call.system).toContain(REASONING_LANGUAGE_RULE);
    expect(call.system).not.toContain('ХОД МЫСЛИ');
    expect(call.system).not.toContain('без хода мысли');
    expect(JSON.stringify(res)).toContain('ХОД МЫСЛИ:\\nРазмышляю.\\n\\nОТВЕТ:\\nОтвет.');
  });

  it('без режима рассуждений рассуждение выключено', async () => {
    vi.mocked(generate).mockResolvedValue({ text: 'Ответ.', tokensIn: 10, tokensOut: 10, model: 'test-model' });
    await chatWithAILogic(ctxSpy(), 'user_1', payload());
    const call = vi.mocked(generate).mock.calls[0]![0];
    expect(call.reasoningEffort).toBeUndefined();
    expect(call.system).not.toContain(REASONING_LANGUAGE_RULE);
  });

  // DL-19 (владелец 25.10): без потока — та же пометка, признак — выданные токены
  // на потолке. Мутация: убрать `cut` → красный.
  it('ответ на потолке вывода получает пометку, обычный — нет', async () => {
    const ctx = ctxSpy();
    vi.mocked(generate).mockResolvedValue({ text: 'Оборванный ответ', tokensIn: 10, tokensOut: 3000, model: 'test-model' });
    const cut = await chatWithAILogic(ctx, 'u1', payload()) as { result: string };
    expect(cut.result.endsWith(ANSWER_CUT_NOTE)).toBe(true);
    vi.mocked(generate).mockResolvedValue({ text: 'Целый ответ', tokensIn: 10, tokensOut: 900, model: 'test-model' });
    const whole = await chatWithAILogic(ctx, 'u1', payload()) as { result: string };
    expect(whole.result).not.toContain(ANSWER_CUT_NOTE);
  });

  // Дейлик 27.10 Н-4: к английскому ответу — английская пометка, не русская.
  // Мутация: одна константа на оба языка → красный.
  it('английский ход на потолке получает английскую пометку', async () => {
    vi.mocked(generate).mockResolvedValue({ text: 'A cut answer', tokensIn: 10, tokensOut: 3000, model: 'test-model' });
    const cut = await chatWithAILogic(ctxSpy(), 'u1', payload({ messages: [{ role: 'user', content: 'Please rate my note about today, what do you think of it?' }] })) as { result: string };
    expect(cut.result.endsWith(ANSWER_CUT_NOTE_EN)).toBe(true);
    expect(cut.result).not.toContain(ANSWER_CUT_NOTE);
  });
});
