import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatWithAILogic } from '../ai/chatWithAI.logic';
import { generate } from '../ai/provider';
import type { AiContext } from '../../src/shared/ai/context.js';
import { validateInternalCallRestrictions, SYSTEM_TASK_MAX_INPUT_CHARS } from '../../src/shared/ai/aiPolicy.js';
import { SYSTEM_TASK_PROMPTS } from '../../src/shared/ai/systemTaskPrompts.js';
import { API_MSG_CAP } from '../../src/features/ai/utils/aiChatTransport.js';

// R7Q-018: `system_task` был единственным внутренним вызовом без потолка входа
// (DA-2 закрыл 4000 знаков для остальных) при самом большом резерве на вызов
// (2048 выходных + оценка входа до 200 000 знаков) и платит из пула
// `internal_chat` (60/день), а не из чатового (30/день). Один аккаунт мог
// зарезервировать ~4 М токенов в день — около 16 % общего дневного лимита
// провайдера — и упереть остальных в 429.
vi.mock('../ai/provider', () => ({
  generate: vi.fn(),
  getActiveModel: vi.fn().mockResolvedValue('test-model'),
}));

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
  } as unknown as AiContext;
}

const systemTask = (chars: number) => ({
  callType: 'system_task' as const,
  personaId: 'custom' as const,
  customSystemPrompt: SYSTEM_TASK_PROMPTS.dialogueSummary,
  messages: [{ role: 'user' as const, content: 'x'.repeat(chars) }],
});

describe('R7Q-018: у system_task есть потолок входа', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generate).mockResolvedValue({ text: 'ok', tokensIn: 10, tokensOut: 10, model: 'test-model' });
  });

  it('перебор — отказ до обращения к провайдеру', async () => {
    const oversized = systemTask(SYSTEM_TASK_MAX_INPUT_CHARS + 1);

    expect(() => validateInternalCallRestrictions(oversized)).toThrow(/exceeds 100000 characters/);

    const ctx = ctxSpy();
    await expect(chatWithAILogic(ctx, 'u_cap', oversized)).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled();
  });

  it('легитимный вход проходит (дайджест диалога: 10 окон по API_MSG_CAP)', () => {
    const legit = API_MSG_CAP * 10;
    expect(legit).toBeLessThan(SYSTEM_TASK_MAX_INPUT_CHARS);
    expect(() => validateInternalCallRestrictions({
      ...systemTask(legit),
    })).not.toThrow();
  });

  it('потолок меньше прежнего отсутствия границы и больше 4000 остальных вызовов', () => {
    expect(SYSTEM_TASK_MAX_INPUT_CHARS).toBeGreaterThan(4000);
    // Резерв на вызов считается из длины входа: потолок обязан урезать и худший
    // случай — 200 000 знаков больше недопустимы.
    expect(SYSTEM_TASK_MAX_INPUT_CHARS).toBeLessThan(200_000);
  });
});
