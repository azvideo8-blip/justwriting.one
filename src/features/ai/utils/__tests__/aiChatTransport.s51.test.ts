import { describe, it, expect } from 'vitest';
import { splitAttachedMessage, toApiContent, prepareApiMessages } from '../aiChatTransport';

// S-51 (S-39): ходы, записанные до 2026-07-15, не несут шапки `[#id · дата]` —
// только маркер, тело заметки и «Вопрос: …». toApiContent требовал шапку и
// отдавал в модель тело целиком: в продолжении диалога, при перегенерации
// («забудь всё» в заметке — 400 от фильтра инъекций) и в извлечении памяти.

// Тело старого хода — заметка, то есть заведомо длиннее короткого вопроса.
const SECRET = 'SECRET тело заметки, которое в модель не идёт. ' + 'Ещё строка дневника. '.repeat(120);
const LEGACY_Q = `[Прикреплена заметка: "Старая"]\n\n${SECRET}\n\n— — —\nВопрос: что скажешь?`;
const LEGACY_NO_Q = `[Прикреплена заметка: "Старая"]\n\n${SECRET}`;
const LEGACY_MULTI = `[Прикреплена заметка: "Первая"]\n\n${SECRET} 1\n\n---\n\n[Прикреплена заметка: "Вторая"]\n\n${SECRET} 2\n\n— — —\nВопрос: сравни`;

describe('S-51: legacy attached turns (no [#id · date] header)', () => {
  it('single note with a question → marker + question, body dropped', () => {
    expect(splitAttachedMessage(LEGACY_Q)).toEqual({ markers: '[Прикреплена заметка: "Старая"]', question: 'что скажешь?' });
    const api = toApiContent(LEGACY_Q);
    expect(api).toBe('[Прикреплена заметка: "Старая"]\n\nчто скажешь?');
    expect(api).not.toContain('SECRET');
  });

  it('single note without a question → marker only', () => {
    expect(toApiContent(LEGACY_NO_Q)).toBe('[Прикреплена заметка: "Старая"]');
  });

  it('the long-note turn of the current client (marker + short question, no separator) is kept as is', () => {
    const longNoteTurn = '[Прикреплена заметка: "Длинная"]\n\nчто ты думаешь об этом?';
    expect(splitAttachedMessage(longNoteTurn)).toBeNull();
    expect(toApiContent(longNoteTurn)).toBe(longNoteTurn);
  });

  it('several notes → every marker, no bodies', () => {
    const api = toApiContent(LEGACY_MULTI);
    expect(api).toBe('[Прикреплена заметка: "Первая"]\n[Прикреплена заметка: "Вторая"]\n\nсравни');
  });

  it('prepareApiMessages strips legacy bodies from the history and keeps the question', () => {
    const out = prepareApiMessages([
      { role: 'user', content: LEGACY_Q, type: 'chat' },
      { role: 'assistant', content: 'Ответ', type: 'chat' },
    ]);
    expect(out.map(m => m.content).join('\n')).not.toContain('SECRET');
    expect(out[0]!.content).toContain('что скажешь?');
  });

  it('a typed message that looks like a header but never closes the marker is kept as text, not stripped to an empty string', () => {
    const typed = '[#x · 2026-01-01]\n[Прикреплена заметка: "без закрывающей скобки\nи дальше мой собственный текст';
    expect(splitAttachedMessage(typed)).toBeNull();
    expect(toApiContent(typed)).toBe(typed);
    const legacyTyped = '[Прикреплена заметка: "тоже без конца — просто начал так писать';
    expect(toApiContent(legacyTyped)).toBe(legacyTyped);
  });
});
