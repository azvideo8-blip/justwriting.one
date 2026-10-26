// RA1-13 (п.10 отчёта RA-1): ответы ИИ не кормят извлечение памяти. Раньше в
// окно извлечения шли и ответы ассистента (600 знаков) — прошлый ответ
// становился «фактом о человеке» (живые 8.2, 9.1→10.3). Решение: извлекаем
// только из реплик человека; ответы ИИ не идут даже как контекст, потому что
// именно они и были источником выдуманных фактов, а клиент не может отличить
// «факт» модели от факта человека после ответа.
// Фальсификация: вернуть assistant в окно извлечения → красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const extractChatMemory = vi.fn().mockResolvedValue({ ok: true, memories: [] });
vi.mock('../AIService', () => ({
  AIService: { extractChatMemory: (...a: unknown[]) => extractChatMemory(...a) },
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../utils/aiDegradationReporter', () => ({ reportAIDegradation: vi.fn() }));

import { AIChatMemoryService } from '../AIChatMemoryService';

describe('RA1-13: память извлекается только из реплик человека', () => {
  beforeEach(() => extractChatMemory.mockClear());

  it('факт, сказанный только ИИ, в извлечение не попадает', async () => {
    const aiOnlyFact = 'ты ненавидишь утренние созвоны и хочешь уйти с работы в марте';
    await AIChatMemoryService.extractFromDialogue('d13', [
      { role: 'user', content: 'сегодня тяжело, опять созвоны с утра' },
      { role: 'assistant', content: `Понял: ${aiOnlyFact}. Это повторяется.` },
      { role: 'user', content: 'да, и я всё чаще думаю про другую работу' },
    ]);

    expect(extractChatMemory).toHaveBeenCalledTimes(1);
    const sent = extractChatMemory.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    expect(sent.messages.every(m => m.role === 'user'), 'в извлечение уходят только реплики человека').toBe(true);
    expect(JSON.stringify(sent)).not.toContain('ненавидишь утренние созвоны');
  });

  it('окно без реплик человека не вызывает извлечение', async () => {
    await AIChatMemoryService.extractFromDialogue('d13b', [
      { role: 'assistant', content: 'длинный ответ ассистента, который не должен кормить память' },
      { role: 'assistant', content: 'второй длинный ответ ассистента' },
    ]);
    expect(extractChatMemory).not.toHaveBeenCalled();
  });
});
