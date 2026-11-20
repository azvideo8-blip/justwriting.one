// К28-3: в выписку памяти не уходит текст, вставленный человеком из ответа модели.
// Над настоящим extractFromDialogue; подменён только край — AIService.extractChatMemory.
// Мутации: не вызывать stripEchoedAssistantText — красный; отправлять ответы модели — красный
// (в RA1-13 «только реплики человека»).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const extractChatMemory = vi.fn().mockResolvedValue({ ok: true, memories: [] });
vi.mock('../AIService', () => ({
  AIService: { extractChatMemory: (...a: unknown[]) => extractChatMemory(...a) },
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../utils/aiDegradationReporter', () => ({ reportAIDegradation: vi.fn() }));

import { AIChatMemoryService } from '../AIChatMemoryService';

const MODEL_PHRASE = 'ты откладываешь разговор с начальником, потому что боишься услышать отказ';

describe('К28-3: извлечение памяти вычитает слова модели из реплик человека', () => {
  beforeEach(() => extractChatMemory.mockClear());

  it('реплика = фраза модели в кавычках + «похоже» — в запрос уходит только «похоже»', async () => {
    await AIChatMemoryService.extractFromDialogue('dk28', [
      { role: 'user', content: 'опять тянул с разговором, не знаю почему' },
      { role: 'assistant', content: `Похоже, ${MODEL_PHRASE}. Так ли это?` },
      { role: 'user', content: `«${MODEL_PHRASE}» — похоже на правду` },
    ]);
    expect(extractChatMemory).toHaveBeenCalledTimes(1);
    const sent = extractChatMemory.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    expect(sent.messages.every(m => m.role === 'user')).toBe(true);
    expect(JSON.stringify(sent)).not.toContain('откладываешь');
    expect(sent.messages.at(-1)!.content).toContain('похоже на правду');
  });

  it('реплика целиком из слов модели — выбрасывается, остальные идут', async () => {
    await AIChatMemoryService.extractFromDialogue('dk28b', [
      { role: 'user', content: 'опять тянул с разговором, не знаю почему' },
      { role: 'assistant', content: `Похоже, ${MODEL_PHRASE}.` },
      { role: 'user', content: `«${MODEL_PHRASE}»` },
    ]);
    const sent = extractChatMemory.mock.calls[0]![0] as { messages: { content: string }[] };
    expect(sent.messages).toHaveLength(1);
    expect(sent.messages[0]!.content).toContain('тянул с разговором');
  });

  it('КОНТРОЛЬ: свои слова человека — как были', async () => {
    const own = 'я правда боюсь, что мне откажут, и поэтому тяну';
    await AIChatMemoryService.extractFromDialogue('dk28c', [
      { role: 'user', content: 'опять тянул с разговором, не знаю почему' },
      { role: 'assistant', content: `Похоже, ${MODEL_PHRASE}.` },
      { role: 'user', content: own },
    ]);
    const sent = extractChatMemory.mock.calls[0]![0] as { messages: { content: string }[] };
    expect(sent.messages.at(-1)!.content).toBe(own);
  });
});
