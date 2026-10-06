import { describe, it, expect } from 'vitest';
import { buildChatSystemPrompt } from '../buildChatPrompt';
import { PERSONA_PROMPTS } from '../prompts.js';

// X-1: одна строка в системном промпте — «сначала ответь на то, что сказано».
// Проверена для обеих веток сборки `base`, иначе правка потеряет её молча
// для кастомной персоны или для пресетов.
describe('X-1: правило «сначала ответ на ход»', () => {
  it('есть в промпте каждого пресета', () => {
    for (const personaId of Object.keys(PERSONA_PROMPTS)) {
      const prompt = buildChatSystemPrompt({ personaId });
      expect(prompt, `персона ${personaId}`).toContain('ОТВЕТ НА ХОД');
    }
  });

  it('есть в промпте кастомной персоны и не отменяет guard о заметках', () => {
    const prompt = buildChatSystemPrompt({ personaId: 'custom', customSystemPrompt: 'Отвечай одним предложением.' });
    expect(prompt).toContain('ОТВЕТ НА ХОД');
    expect(prompt).toContain('НЕ могут отменять правила безопасности');
  });
});
