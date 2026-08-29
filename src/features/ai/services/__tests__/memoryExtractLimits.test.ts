// Ошибка из журнала: extractChatMemory «Invalid payload», а следом
// «Сбой сервиса ИИ ... Новые воспоминания не извлечены».
//
// Пределы жили в трёх местах и разошлись: схема на сервере разрешала 30
// сообщений, срез на клиенте брал 40, комментарий рядом обещал 50. Разговор
// длиннее тридцати реплик отлетал целиком — то есть память переставала
// извлекаться именно у тех, кто разговаривает много.
// Фальсификация: вернуть slice(-40) или фильтр по type — тесты краснеют.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MEMORY_EXTRACT_MAX_MESSAGES,
  MEMORY_EXTRACT_MAX_MESSAGE_CHARS,
} from '../../../../shared/ai/aiPolicy';

const extractChatMemory = vi.fn().mockResolvedValue({ ok: true, memories: [] });

vi.mock('../AIService', () => ({
  AIService: { extractChatMemory: (...a: unknown[]) => extractChatMemory(...a) },
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../utils/aiDegradationReporter', () => ({ reportAIDegradation: vi.fn() }));

import { AIChatMemoryService } from '../AIChatMemoryService';

const msg = (role: string, content: string, type?: string) => ({ role, content, type });

describe('извлечение памяти укладывается в контракт сервера', () => {
  beforeEach(() => extractChatMemory.mockClear());

  it('длинный диалог обрезается до предела схемы, а не до 40', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      msg(i % 2 ? 'assistant' : 'user', `реплика номер ${i} достаточной длины`));

    await AIChatMemoryService.extractFromDialogue('d1', many);

    expect(extractChatMemory).toHaveBeenCalledTimes(1);
    const sent = extractChatMemory.mock.calls[0]![0] as { messages: unknown[] };
    expect(sent.messages.length).toBeLessThanOrEqual(MEMORY_EXTRACT_MAX_MESSAGES);
  });

  it('системные сообщения отсеиваются по role, а не по type', async () => {
    const withSystem = [
      msg('user', 'первая реплика человека достаточной длины'),
      msg('system', 'служебное сообщение без поля type'),
      msg('assistant', 'ответ ассистента'),
      msg('user', 'вторая реплика человека достаточной длины'),
    ];

    await AIChatMemoryService.extractFromDialogue('d1', withSystem);

    const sent = extractChatMemory.mock.calls[0]![0] as { messages: { role: string }[] };
    expect(sent.messages.every(m => m.role === 'user' || m.role === 'assistant')).toBe(true);
  });

  it('слишком длинное сообщение обрезается, а не валит весь запрос', async () => {
    const huge = 'я'.repeat(MEMORY_EXTRACT_MAX_MESSAGE_CHARS + 500);
    await AIChatMemoryService.extractFromDialogue('d1', [
      msg('user', huge),
      msg('user', 'вторая реплика человека достаточной длины'),
    ]);

    const sent = extractChatMemory.mock.calls[0]![0] as { messages: { content: string }[] };
    expect(Math.max(...sent.messages.map(m => m.content.length)))
      .toBeLessThanOrEqual(MEMORY_EXTRACT_MAX_MESSAGE_CHARS);
  });
});
