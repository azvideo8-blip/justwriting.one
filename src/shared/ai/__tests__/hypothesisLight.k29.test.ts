// К29-2: прямая просьба без опор — правило «версии по самой записи», и причина в журнале.
import { describe, expect, it } from 'vitest';
import { assembleChatPromptParams, buildChatSystemPrompt, chatInputSchema } from '../buildChatPrompt';
import { chatShape, HYPO_WHY } from '../chatShape';
import { HYPOTHESIS_BODY_LINE, HYPOTHESIS_DIRECT_MARK, HYPOTHESIS_LIGHT_MARK, HYPOTHESIS_RULE_DIRECT, HYPOTHESIS_RULE_LIGHT, HYPOTHESIS_TURN_MARK } from '../hypothesisRule';

const NOTE = '[#n1 · 20261125]\n[Прикреплена заметка: "Утро"]\nОпять отложил разговор.';
const build = (doc: string, over: object = {}) => buildChatSystemPrompt({
  ...assembleChatPromptParams({
    personaId: 'ta', documentContent: doc, noteScope: { mode: 'note', title: 'Утро', date: '25 ноября 2026 г.' },
    messages: [{ role: 'user', content: 'какие тут гипотезы?' }], ...over,
  } as never),
  rnd: () => 0,
});
const LIGHT = `${NOTE}\n\n${HYPOTHESIS_LIGHT_MARK}`;

describe('К29-2: облегчённое правило', () => {
  it('строгий ход с меткой — правило есть, вне ограды данных', () => {
    const p = build(LIGHT);
    expect(p).toContain(HYPOTHESIS_RULE_LIGHT);
    expect(p.indexOf(HYPOTHESIS_RULE_LIGHT)).toBeGreaterThan(p.lastIndexOf(HYPOTHESIS_LIGHT_MARK));
  });

  it.each([
    ['без метки', () => build(NOTE)],
    ['кризис', () => build(LIGHT, { crisis: true })],
    ['широкий ход', () => build(LIGHT, { noteScope: { mode: 'wide', title: 'Утро', date: '25 ноября 2026 г.' } })],
    ['Редактор', () => build(LIGHT, { personaId: 'editor' })],
    ['своя персона', () => build(LIGHT, { personaId: 'custom', customSystemPrompt: 'Говори тепло.' })],
  ])('%s — правила нет', (_n, run) => {
    expect(run()).not.toContain(HYPOTHESIS_RULE_LIGHT);
  });

  it('есть опоры — правило нескольких версий, а не облегчённое', () => {
    const p = build(`${NOTE}\n\n${HYPOTHESIS_TURN_MARK}\n${HYPOTHESIS_DIRECT_MARK}\n\n${HYPOTHESIS_LIGHT_MARK}`);
    expect(p).toContain(HYPOTHESIS_RULE_DIRECT);
    expect(p).not.toContain(HYPOTHESIS_RULE_LIGHT);
  });

  it('строка о теле — только когда в записи есть сон или усталость', () => {
    expect(build(LIGHT)).not.toContain(HYPOTHESIS_BODY_LINE);
    expect(build(`${NOTE} Плохо спал.\n\n${HYPOTHESIS_LIGHT_MARK}`)).toContain(HYPOTHESIS_BODY_LINE);
  });

  it('в правиле нет отказа и слов о том, что опор нет', () => {
    expect(HYPOTHESIS_RULE_LIGHT).not.toMatch(/связать не с чем|материала .* нет/);
  });
});

describe('К29-2: причина пустого блока — в [chat-shape], перечислением', () => {
  const stats = { cands: 3, picked: 0, quoted: 0, diverse: 0, shown: 0 };
  const shape = (hypoStats: unknown) => chatShape({ personaId: 'ta', messages: [], system: '', hypoStats: hypoStats as never }).hypo;
  const parse = (hypoStats: unknown) => chatInputSchema.safeParse({ personaId: 'ta', messages: [{ role: 'user', content: 'x' }], hypoStats }).data?.hypoStats;

  it.each([...HYPO_WHY])('%s доходит до журнала', why => {
    expect(parse({ ...stats, why })).toEqual({ ...stats, why });
    expect(shape({ ...stats, why })).toEqual({ ...stats, why });
  });

  it('без причины и с посторонней строкой — поля нет', () => {
    expect(shape(stats)).toEqual(stats);
    expect(shape({ ...stats, why: 'текст заметки' })).toEqual(stats);
    expect(parse({ ...stats, why: 'текст заметки' })).toBeUndefined();
  });
});
