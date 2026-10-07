import { describe, it, expect } from 'vitest';
import { PRESET_PERSONAS } from '../AIPersonaService';
import { PERSONA_PROMPTS } from '../../../../shared/ai/prompts';

// Персона без своего промпта на сервере молча получала промпт коуча
// (buildChatPrompt: `PERSONA_PROMPTS[id] ?? PERSONA_PROMPTS.coach`).
describe('персоны интерфейса', () => {
  it('у каждой есть собственный серверный промпт', () => {
    for (const p of PRESET_PERSONAS) {
      expect(Object.keys(PERSONA_PROMPTS), p.id).toContain(p.id);
    }
  });

  it('«Редактор» вернулся: собирает пост из заметок, без вопросов-рефлексий в конце', () => {
    expect(PRESET_PERSONAS.map(p => p.id)).toContain('editor');
    expect(PERSONA_PROMPTS.editor).toMatch(/publishable post/);
    expect(PERSONA_PROMPTS.editor).toMatch(/never write a post from nothing/);
  });
});
