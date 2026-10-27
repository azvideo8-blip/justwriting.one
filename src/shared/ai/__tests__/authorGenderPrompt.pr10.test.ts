import { describe, expect, it } from 'vitest';
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
