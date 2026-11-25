import { describe, expect, it } from 'vitest';
import { PERSONA_PROMPTS } from '../prompts';
import { assembleChatPromptParams, buildChatSystemPrompt, chatInputSchema } from '../buildChatPrompt';

// PR-10 (18.2): род уезжает строкой только в промпт Редактора и только когда
// код нашёл однозначные формы.
describe('PR-10: строка рода в промпте Редактора', () => {
  it('женский род — строка есть', () => {
    expect(buildChatSystemPrompt({ personaId: 'editor', authorGender: 'f' })).toContain('женском роде');
  });

  it('мужской род — строка есть', () => {
    expect(buildChatSystemPrompt({ personaId: 'editor', authorGender: 'm' })).toContain('мужском роде');
  });

  it('род не определён — строки нет', () => {
    expect(buildChatSystemPrompt({ personaId: 'editor' })).not.toContain('РОД АВТОРА');
    expect(buildChatSystemPrompt({ personaId: 'editor', authorGender: null })).not.toContain('РОД АВТОРА');
  });

  it('другие персоны строку не получают', () => {
    expect(buildChatSystemPrompt({ personaId: 'coach', authorGender: 'f' })).not.toContain('РОД АВТОРА');
  });
});

describe('PR-10: поле в схеме запроса', () => {
  it('принимает только m и f', () => {
    const base = { personaId: 'editor' as const, messages: [{ role: 'user' as const, content: 'привет' }] };
    expect(chatInputSchema.safeParse({ ...base, authorGender: 'f' }).success).toBe(true);
    expect(chatInputSchema.safeParse({ ...base, authorGender: 'x' }).success).toBe(false);
  });

  it('род доходит до параметров промпта', () => {
    expect(assembleChatPromptParams({ personaId: 'editor', authorGender: 'm' }).authorGender).toBe('m');
  });
});

// К29-1: строка рода у каждого характера, ровно одна, вне ограды данных.
// Мутации: убрать строку; вернуть условие «только Редактор»; поставить её внутрь ограды — красный.
describe('К29-1: строка рода у всех характеров', () => {
  const personas = [...Object.keys(PERSONA_PROMPTS).filter(p => p !== 'editor'), 'custom'];
  const build = (personaId: string, authorGender?: 'm' | 'f', text = 'Я много думаю об этом') => buildChatSystemPrompt({
    ...assembleChatPromptParams({ personaId, customSystemPrompt: 'Говори тепло.', documentContent: 'Запись о дне.', messages: [{ role: 'user', content: text }], authorGender } as never),
    rnd: () => 0,
  });
  const lines = (p: string) => p.split('\n').filter(l => l.startsWith('РОД '));

  it.each(personas)('%s', persona => {
    for (const [gender, word] of [['m', 'мужской'], ['f', 'женский'], [undefined, 'неизвестен']] as const) {
      const prompt = build(persona, gender);
      expect(lines(prompt)).toHaveLength(1);
      expect(lines(prompt)[0]).toContain(word);
      expect(prompt.indexOf(lines(prompt)[0]!)).toBeGreaterThan(prompt.lastIndexOf('DATA_CONTEXT_END'));
    }
  });

  it('Редактор: своя строка, второй нет; английская реплика — без строки', () => {
    expect(lines(build('editor', 'f'))).toEqual([expect.stringContaining('РОД АВТОРА')]);
    expect(lines(build('editor'))).toEqual([]);
    expect(lines(build('coach', 'f', 'I keep thinking about it'))).toEqual([]);
  });

  it('образцов со скобкой в промптах нет', () => {
    for (const persona of personas) expect(build(persona)).not.toMatch(/[а-яё]\((?:а|ла|ась|на)\)/i);
  });
});
