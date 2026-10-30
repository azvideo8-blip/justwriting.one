// Случай #20 (20.2–20.4, владелец согласовал 29.10): три правила в общих принципах
// диалога, у каждой персоны. Поставлены по замеру scripts/ai-bench/case20-bench.ts
// (deepseek-v4.1-flash, 60 ответов на сценарий, до → после):
//   20.2c условие во втором ходе 37 → 51, 20.3 событие и связь с темой 42 → 48,
//   20.4 свой ответ не источник 47 → 54; контроли 20.2/20.2b/20.4ctl не хуже.
// Мутация: убрать любое из правил → красный (и замер вернётся к «до»).
import { describe, it, expect } from 'vitest';
import { buildChatSystemPrompt, assembleChatPromptParams } from '../buildChatPrompt';

const RULES = ['УСЛОВИЯ ЧЕЛОВЕКА', 'РАЗБОР ЗАПИСИ', 'ТВОИ ПРОШЛЫЕ ОТВЕТЫ — НЕ ЗАПИСИ'];

describe('случай #20: правила есть у каждой персоны', () => {
  for (const personaId of ['group_psychology', 'cbt', 'coach', 'editor']) {
    it(personaId, () => {
      const system = buildChatSystemPrompt(assembleChatPromptParams({ personaId, messages: [{ role: 'user', content: 'привет' }] }));
      for (const rule of RULES) expect(system, `${personaId}: нет правила «${rule}»`).toContain(rule);
    });
  }
});
