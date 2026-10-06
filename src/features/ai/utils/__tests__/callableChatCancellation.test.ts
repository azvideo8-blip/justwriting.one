// SB-4, проводка: `AIService.chat` умел принимать CallAiOptions, но никто сигнал
// не передавал, поэтому «уйти со страницы» обрывало только стрим. callable-путь
// (ответ без стриминга, повтор после отказа токена) дописывался до конца даже
// после закрытия чата.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callableChat } from '../aiChatTransport';
import { AIService } from '../../services/AIService';
import type { CallAiOptions } from '../../../../core/ai/callAi';

describe('SB-4: сигнал чата доходит до callable-пути', () => {
  let sentOpts: CallAiOptions | undefined;

  beforeEach(() => {
    sentOpts = undefined;
    vi.spyOn(AIService, 'chat').mockImplementation(async (_params, opts) => {
      sentOpts = opts;
      return { ok: false, error: 'UPSTREAM' } as never;
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  const base = { personaId: 'p', messages: [{ role: 'user' as const, content: 'вопрос' }] };

  it('opts.signal передаётся в AIService.chat', async () => {
    const controller = new AbortController();
    await expect(callableChat({ ...base, signal: controller.signal })).rejects.toThrow('UPSTREAM');
    expect(sentOpts?.signal).toBe(controller.signal);
  });

  it('отмена — это «стоп», а не ошибка сервера', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(callableChat({ ...base, signal: controller.signal })).rejects.toThrow('ABORTED');
  });

  it('без отмены обычный отказ остаётся обычным отказом', async () => {
    await expect(callableChat(base)).rejects.toThrow('UPSTREAM');
  });

  it('X-2: отказ проверки формулировки доходит кодом, а не «ошибкой сервера»', async () => {
    vi.mocked(AIService.chat).mockResolvedValue({ ok: false, error: 'DISALLOWED_PHRASE' } as never);
    await expect(callableChat(base)).rejects.toThrow('DISALLOWED_PHRASE');
  });
});
