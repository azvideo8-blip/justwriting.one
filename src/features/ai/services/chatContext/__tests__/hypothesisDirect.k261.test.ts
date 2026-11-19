// К26-1 (случай #26): прямая просьба о гипотезах — повод сам по себе, и при
// приложенной заметке; правило нескольких версий; приложенная заметка — не опора.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/retrieval/docSnapshot', () => ({ loadAnalysedIds: async () => new Set(['own', 'a', 'b', 'c', 'd', 'e', 'f', 'g']) }));
vi.mock('../../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { buildAnchorBlock, buildHypothesisBlock, hypothesisAskOf, type HypothesisNote } from '../hypothesisTurn';
import { HYPOTHESIS_DIRECT_MARK, HYPOTHESIS_RULE, HYPOTHESIS_RULE_DIRECT, HYPOTHESIS_TURN_MARK } from '../../../../../shared/ai/hypothesisRule';
import { assembleChatPromptParams, buildChatSystemPrompt } from '../../../../../shared/ai/buildChatPrompt';

describe('К26-1: прямая просьба о гипотезах', () => {
  it.each([
    'Разбери эту запись и предложи гипотезы, почему так',
    'какие тут могут быть гипотезы?',
    'Какие у тебя версии, почему я так реагирую?',
    'Помоги понять, есть ли предположения, откуда это',
  ])('повод: %s', (text) => {
    expect(hypothesisAskOf(text, 'group_psychology')).toBe('direct');
  });

  it('«Транзактный аналитик» — тоже повод (разбор 18.11: гипотез не было)', () => {
    expect(hypothesisAskOf('предложи гипотезы пожалуйста, что мне нужно сделать?', 'ta')).toBe('direct');
  });

  it('Редактор и серая зона — не повод', () => {
    expect(hypothesisAskOf('предложи гипотезы', 'editor')).toBeNull();
    expect(hypothesisAskOf('какие гипотезы, почему я не хочу больше просыпаться', 'cbt')).toBeNull();
  });

  it('блок опор при прямой просьбе несёт вторую метку', () => {
    const cands = [
      { documentId: 'a', date: '2026-03-01', title: 'A', gist: 'суть a' },
      { documentId: 'b', date: '2026-06-01', title: 'B', gist: 'суть b' },
    ];
    const notes: HypothesisNote[] = cands.map(c => ({ id: c.documentId, at: 0, title: c.title, chunks: [`текст ${c.documentId}.`], vectors: [[1, 0]] }));
    const picked = cands.map(c => ({ documentId: c.documentId, quote: `текст ${c.documentId}.` }));
    expect(buildAnchorBlock(cands, picked, notes, true)!.block).toContain(HYPOTHESIS_DIRECT_MARK);
    expect(buildAnchorBlock(cands, picked, notes)!.block).not.toContain(HYPOTHESIS_DIRECT_MARK);
  });
});

describe('К26-1: сервер ставит правило нескольких версий и в строгом ходе', () => {
  const strictScope = { mode: 'note' as const, title: 'Ночь', date: '2026-11-18' };
  const messages = [{ role: 'user', content: 'Какие тут могут быть гипотезы?' }];
  const build = (doc: string, opts: { strict?: boolean; crisis?: boolean } = {}) => buildChatSystemPrompt({
    ...assembleChatPromptParams({ personaId: 'group_psychology', messages, documentContent: doc, crisis: opts.crisis === true, ...(opts.strict ? { noteScope: strictScope } : {}) }),
    rnd: () => 0,
  });
  const direct = `[#own · 20261118]\nтекст заметки\n\n${HYPOTHESIS_TURN_MARK}\n${HYPOTHESIS_DIRECT_MARK}\n\n[#a · 2026-03-01]\nопора`;
  const plain = `[#own · 20261118]\nтекст заметки\n\n${HYPOTHESIS_TURN_MARK}\n\n[#a · 2026-03-01]\nопора`;

  it('строгий ход + метка прямой просьбы → правило нескольких версий', () => {
    const p = build(direct, { strict: true });
    expect(p).toContain(HYPOTHESIS_RULE_DIRECT);
    expect(p).not.toContain(HYPOTHESIS_RULE);
  });
  it('строгий ход без метки прямой просьбы — правила гипотезы нет, как раньше', () => {
    const p = build(plain, { strict: true });
    expect(p).not.toContain(HYPOTHESIS_RULE);
    expect(p).not.toContain(HYPOTHESIS_RULE_DIRECT);
  });
  it('кризисный ход — правила нет', () => {
    expect(build(direct, { strict: true, crisis: true })).not.toContain(HYPOTHESIS_RULE_DIRECT);
  });
  it('обычный ход без прямой просьбы — прежнее правило одной гипотезы', () => {
    expect(build(plain)).toContain(HYPOTHESIS_RULE);
  });
});

describe('К26-1: приложенная заметка — не опора', () => {
  it('excludeIds убирает заметку из кандидатов служебного вызова', async () => {
    const ids = ['own', 'a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const docs = ids.map((id, i) => ({ id, title: id, lastSessionAt: Date.UTC(2026, i, 3) }));
    const emb = ids.map(id => ({ documentId: id, chunkTexts: [`запись ${id}.`], vectors: [[1, 0.01 * ids.indexOf(id)]] }));
    const db = { getAll: async (store: string) => (store === 'documents' ? docs : []) } as never;
    const pick = vi.fn(async () => []);
    await buildHypothesisBlock({
      text: 'какие гипотезы?', turnEmb: [1, 0], db, minTime: undefined, maxTime: undefined, injectedDocumentIds: [],
      allEmbeddings: emb as never, enabled: async () => true, pick, direct: true, excludeIds: ['own'],
    });
    expect(pick).toHaveBeenCalledTimes(1);
    const sent = (pick.mock.calls[0] as unknown as [string, { documentId: string }[]])[1].map(c => c.documentId);
    expect(sent).not.toContain('own');
    expect(sent.length).toBeGreaterThanOrEqual(6);
  });
});

// Случай #27 (27.4): строка «тело и день» стояла в правиле всегда, и сама её
// оговорка «если нет — не пиши» вызывала абзац «о ночи в записи ничего нет».
// Строка идёт в правило только когда в материале хода есть сон, болезнь, усталость.
describe('27.4: «тело и день» — только когда в записи есть тело', () => {
  const messages = [{ role: 'user', content: 'приведи несколько гипотез' }];
  const build = (note: string) => buildChatSystemPrompt({
    ...assembleChatPromptParams({ personaId: 'ta', messages, documentContent: `[#own · 20261119]\n${note}\n\n${HYPOTHESIS_TURN_MARK}\n${HYPOTHESIS_DIRECT_MARK}\n\n[#a · 2026-03-01]\nопора`, noteScope: { mode: 'note' as const, title: 'Синтетика', date: '2026-11-19' } }),
    rnd: () => 0,
  });

  it('о сне и усталости ни слова — строки нет', () => {
    const p = build('Думаю о деньгах и о том, на что их тратить.');
    expect(p).toContain(HYPOTHESIS_RULE_DIRECT);
    expect(p).not.toContain('ТЕЛО И ДЕНЬ');
  });
  it.each(['Ночью почти не спал, с утра разбитый.', 'Третий день болею, температура.', 'Сильно устал за неделю.'])('есть «%s» — строка есть', (note) => {
    expect(build(note)).toContain('ТЕЛО И ДЕНЬ');
  });
});
