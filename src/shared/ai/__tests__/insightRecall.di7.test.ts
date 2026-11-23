// DI-7: блок прошлого вывода и правило хода. Мутации:
//  - правило внутрь ограды данных (до DATA_CONTEXT_END) → красный «правило после всех оград»;
//  - убрать crisis !== true → красный «кризисный ход»;
//  - убрать HYPOTHESIS_PERSONAS → красный «Редактор»;
//  - убрать !strictNote → красный «строгий ход»;
//  - правило после гипотезы → красный «перед правилом гипотезы».
import { describe, it, expect } from 'vitest';
import {
  INSIGHT_RECALL_MARK,
  INSIGHT_RECALL_RULE,
  INSIGHT_MATCH_MAX_TOKENS,
  insightRecallBlock,
  buildInsightMatchUserMessage,
  parseInsightMatch,
} from '../insightRecall';
import { buildChatSystemPrompt } from '../buildChatPrompt';
import { HYPOTHESIS_TURN_MARK, HYPOTHESIS_RULE } from '../hypothesisRule';

const TEXT = 'Своё ты ставишь в конец очереди, а очередь не кончается.';

describe('insightRecall: блок и служебный вызов', () => {
  it('блок: дата кодом дд.мм.гггг, вывод в ёлочках, внутренние ёлочки заменены', () => {
    const block = insightRecallBlock({ date: '2026-10-05', text: 'Он сказал «да» и замолчал.' });
    expect(block).toBe(`${INSIGHT_RECALL_MARK}\n— 05.10.2026: «Он сказал "да" и замолчал.»`);
  });

  it('сообщение служебного вызова: ограда данных, нумерация, обрезка 1200/400', () => {
    const msg = buildInsightMatchUserMessage('x'.repeat(1_500), [
      { text: 't'.repeat(500), ctx: 'c'.repeat(500) },
      { text: 'второй', ctx: 'контекст' },
    ]);
    expect(msg.startsWith('[DATA_START]')).toBe(true);
    expect(msg.endsWith('[DATA_END]')).toBe(true);
    expect(msg).toContain('1. Человек тогда рассказал: ' + 'c'.repeat(400));
    expect(msg).toContain('Вывод: ' + 't'.repeat(400));
    expect(msg).not.toContain('t'.repeat(401));
    expect(msg).toContain('2. Человек тогда рассказал: контекст');
    expect(msg).toContain('x'.repeat(1_200));
    expect(msg).not.toContain('x'.repeat(1_201));
  });

  it('parseInsightMatch: номер в списке, 0 и вне списка — 0, не-JSON — 0', () => {
    expect(parseInsightMatch('{"match": 2}', 3)).toBe(2);
    expect(parseInsightMatch('{"match": 0}', 3)).toBe(0);
    expect(parseInsightMatch('{"match": 4}', 3)).toBe(0);
    expect(parseInsightMatch('никакого json', 3)).toBe(0);
    expect(parseInsightMatch('{"match": -1}', 3)).toBe(0);
    expect(INSIGHT_MATCH_MAX_TOKENS).toBe(60);
  });
});

describe('buildChatSystemPrompt: правило прошлого вывода', () => {
  const withMark = `${INSIGHT_RECALL_MARK}\n— 05.10.2026: «${TEXT}»`;

  it('метка в материалах → правило после всех DATA_CONTEXT_END', () => {
    const prompt = buildChatSystemPrompt({
      personaId: 'coach',
      documentContent: withMark,
      userPortrait: 'Портрет человека.',
      memoryContext: 'Память о человеке.',
    });
    expect(prompt).toContain(INSIGHT_RECALL_RULE);
    const lastFence = prompt.lastIndexOf('DATA_CONTEXT_END');
    expect(prompt.indexOf(INSIGHT_RECALL_RULE)).toBeGreaterThan(lastFence);
    // Мутация: положить правило внутрь ограды данных — красный.
  });

  it('метка и гипотеза в одном ходе → правило вывода ПЕРЕД правилом гипотезы', () => {
    const prompt = buildChatSystemPrompt({
      personaId: 'coach',
      documentContent: `${withMark}

${HYPOTHESIS_TURN_MARK}
Записи разных дней.`,
    });
    const recallAt = prompt.indexOf(INSIGHT_RECALL_RULE);
    const hypoAt = prompt.indexOf(HYPOTHESIS_RULE);
    expect(recallAt).toBeGreaterThan(-1);
    expect(hypoAt).toBeGreaterThan(-1);
    expect(recallAt).toBeLessThan(hypoAt);
    // Мутация: правило вывода после гипотезы — красный.
  });

  it('кризисный ход → правила нет', () => {
    const prompt = buildChatSystemPrompt({ personaId: 'coach', documentContent: withMark, crisis: true });
    expect(prompt).not.toContain(INSIGHT_RECALL_RULE);
    // Мутация: убрать crisis !== true — красный.
  });

  it('Редактор → правила нет', () => {
    const prompt = buildChatSystemPrompt({ personaId: 'editor', documentContent: withMark });
    expect(prompt).not.toContain(INSIGHT_RECALL_RULE);
    // Мутация: убрать проверку характера — красный.
  });

  it('строгий ход по заметке → правила нет', () => {
    const prompt = buildChatSystemPrompt({ personaId: 'coach', documentContent: withMark, noteScope: { mode: 'note', title: 'Синтетическая', date: '2026-10-05' } });
    expect(prompt).not.toContain(INSIGHT_RECALL_RULE);
    // Мутация: убрать !strictNote — красный.
  });

  it('без метки → правила нет', () => {
    const prompt = buildChatSystemPrompt({ personaId: 'coach', documentContent: 'Обычные материалы хода.' });
    expect(prompt).not.toContain(INSIGHT_RECALL_RULE);
  });
});