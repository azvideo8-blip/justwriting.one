// К21-2 (случай #21, 02.11): правило поведения на ход о происхождении сказанного
// раньше. Человек спрашивает «откуда ты это взял», а в материалах этого хода
// источника нет — модель должна сказать, что проверить не может, и назвать, на
// чём это, вероятно, было основано.
// Правило — поведением, без примеров-фраз: deepseek копирует примеры дословно и
// начинает их повторять (память ai-dialogue-prompt-ab-harness), поэтому тест
// следит, что в правиле не появилось ни одной цитаты-примера.
// Мутация: убрать правило из NOTES_GUARD_BASE → краснеют первые два теста;
// добавить в правило пример в кавычках → краснеет третий.
import { describe, expect, it } from 'vitest';
import { NOTES_GUARD_BASE } from '../prompts.js';
import { buildChatSystemPrompt, assembleChatPromptParams } from '../buildChatPrompt.js';

const RULE_MARK = 'ПРОИСХОЖДЕНИЕ СКАЗАННОГО РАНЬШЕ';

const PERSONAS = ['group_psychology', 'cbt', 'coach', 'editor', 'custom'];
// Ход с выдачей поиска (hasSearch) и без неё: правило должно быть в обоих —
// источник может отсутствовать и когда найденное есть, но оно не о том.
const DOCUMENT_CONTENTS = [
  undefined,
  'Результаты поиска по архиву заметок\n[#local_x1 · 12.10.2026]\nЗаметка 1: "Чужой текст"',
];

function ruleSpan(): string {
  const at = NOTES_GUARD_BASE.indexOf(RULE_MARK);
  if (at < 0) return '';
  return NOTES_GUARD_BASE.slice(at);
}

describe('К21-2: правило о происхождении сказанного раньше', () => {
  it('правило есть в NOTES_GUARD_BASE', () => {
    expect(NOTES_GUARD_BASE).toContain(RULE_MARK);
  });

  it('правило доезжает до системного промпта каждой персоны, с выдачей и без', () => {
    for (const personaId of PERSONAS) {
      for (const documentContent of DOCUMENT_CONTENTS) {
        const system = buildChatSystemPrompt(assembleChatPromptParams({
          personaId,
          customSystemPrompt: personaId === 'custom' ? 'Тихий внутренний голос.' : undefined,
          documentContent,
          messages: [{ role: 'user', content: 'Откуда ты это взял?' }],
        }));
        expect(system, `${personaId}, documentContent=${documentContent ? 'выдача' : 'нет'}`).toContain(RULE_MARK);
      }
    }
  });

  it('правило — поведением: ни одной фразы-примера в кавычках', () => {
    const span = ruleSpan();
    expect(span.length).toBeGreaterThan(RULE_MARK.length);
    expect(span).not.toMatch(/[«»"]/);
  });
});
