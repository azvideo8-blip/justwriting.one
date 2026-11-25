// К29-2 (случай #29): прямая просьба о гипотезах по неразобранной записи. Вектора у неё
// нет — он считается в этом же ходе и не хранится; опор не нашлось — облегчённое правило,
// а не отказ. Над настоящим buildContext и IndexedDB; подменён край (embed, pickAnchors, флаг).
// Мутации — в отчёте пакета 0.11.27.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';

const h = vi.hoisted(() => ({ flag: vi.fn(), consent: true, uid: 'u-k29' }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/supabase/client', () => ({ getSupabase: () => { throw new Error('сети в тесте нет'); } }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));
vi.mock('../../../../core/auth', async importActual => ({ ...(await importActual<object>()), getCurrentUser: () => ({ uid: h.uid }) }));
vi.mock('../../../../core/ai/indexingConsent', async importActual => ({ ...(await importActual<object>()), hasIndexingConsent: () => h.consent }));
vi.mock('../../../../core/sync/syncFlags', () => ({ answerChronicleV2Enabled: async () => false, chatInsightsEnabled: async () => false, chatHypothesesEnabled: (...a: unknown[]) => h.flag(...a) as Promise<boolean> }));

import { useAIChatContext } from '../aiChatContext';
import { AIService } from '../AIService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { setEncryptionEnabled, setProfileLoaded } from '../../../../core/crypto/cryptoHelpers';
import { HYPOTHESIS_DIRECT_MARK, HYPOTHESIS_LIGHT_MARK } from '../../../../shared/ai/hypothesisRule';

const OWN = 'local_own';
const OTHERS = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'];
const day = (n: number) => Date.UTC(2026, 9, n);
const doc = (id: string, n: number, over: object = {}) => ({
  id, guestId: h.uid, title: id, currentVersion: 1, totalWords: 1, totalDuration: 0, sessionsCount: 1,
  firstSessionAt: day(n), lastSessionAt: day(n), tags: [], ...over,
});
const vec = (id: string, v: number[], i: number) => ({
  documentId: id, vectors: [v], chunkTexts: [`Текст записи ${id}. Второе предложение ${i}.`], model: 'm', dim: 3,
  contentHash: id, processedAt: 1, schemaV: 1,
});
const embed = vi.spyOn(AIService, 'embed');
const pick = vi.spyOn(AIService, 'pickAnchors');

beforeEach(async () => {
  vi.clearAllMocks();
  h.consent = true;
  h.flag.mockResolvedValue(true);
  setProfileLoaded(h.uid, true);
  setEncryptionEnabled(h.uid, false);
  embed.mockResolvedValue({ ok: true, vectors: [[1, 0, 0]], chunks: [], model: 'm', dim: 3 });
  pick.mockImplementation(async (_m, c) => c.slice(0, 2).map(x => ({ documentId: x.documentId })) as never);
  const db = await getLocalDb();
  for (const s of ['documents', 'aiEmbeddings', 'aiSummaries'] as const) await db.clear(s);
  await db.put('documents', doc(OWN, 25) as never);
  for (const [i, id] of OTHERS.entries()) {
    await db.put('documents', doc(id, i + 1) as never);
    // Каждая близка к реплике, но друг к другу — нет (разные темы).
    await db.put('aiEmbeddings', vec(id, [0.6, Math.cos(i), Math.sin(i)], i) as never);
    await db.put('aiSummaries', { documentId: id, summary: `суть ${id}`, processedAt: 1 } as never);
  }
});

const NOTE = 'Сегодня опять отложил разговор с отцом и весь вечер перебирал, что сказал бы.';
async function turn(text = 'какие тут гипотезы?', content = NOTE, persona = 'ta') {
  const { result } = renderHook(() => useAIChatContext(persona));
  return result.current.buildContext({
    text, attached: { blocks: [{ documentId: OWN, title: 'Утро', content }] },
    mood: undefined, messageHistory: [], isFirstTurn: true, scope: 'note',
  });
}

describe('К29-2: вектор неразобранной записи — в этом же ходе, без хранения', () => {
  it('просьба прямая, вектора нет → посчитан один раз, не записан, опоры подобраны', async () => {
    const ctx = await turn();
    expect(embed.mock.calls).toEqual([[{ content: NOTE }]]);
    expect(pick).toHaveBeenCalledOnce();
    expect(ctx.searchContext).toContain(HYPOTHESIS_DIRECT_MARK);
    expect(ctx.searchContext).not.toContain(HYPOTHESIS_LIGHT_MARK);
    expect(ctx.hypoStats).toMatchObject({ cands: 7, shown: 2 });
    expect(ctx.hypoStats?.why).toBeUndefined();
    const db = await getLocalDb();
    expect(await db.get('aiEmbeddings', OWN)).toBeUndefined();
    expect(await db.get('aiSummaries', OWN)).toBeUndefined();
  });

  it('вектор есть — вызова нет', async () => {
    const db = await getLocalDb();
    await db.put('aiEmbeddings', vec(OWN, [1, 0, 0], 0) as never);
    await db.put('aiSummaries', { documentId: OWN, summary: 'своя', processedAt: 1 } as never);
    const ctx = await turn();
    expect(embed).not.toHaveBeenCalled();
    expect(ctx.searchContext).toContain(HYPOTHESIS_DIRECT_MARK);
    // Разобранная приложенная запись — не опора самой себе.
    expect(pick.mock.calls[0]![1].map(c => c.documentId)).not.toContain(OWN);
  });

  it.each([
    ['не просьба о гипотезах', () => turn('о чём эта запись?')],
    ['кризис в записи', () => turn('какие тут гипотезы?', 'Я хочу покончить с собой, план готов.')],
    ['серая зона в реплике', () => turn('какие гипотезы, почему я не хочу больше жить?')],
    ['серая зона в записи', () => turn('какие тут гипотезы?', 'Не хочу просыпаться.')],
    ['Редактор', () => turn('какие тут гипотезы?', NOTE, 'editor')],
  ])('%s — ни вызова, ни правила', async (_n, run) => {
    const ctx = await run();
    expect(embed).not.toHaveBeenCalled();
    expect(pick).not.toHaveBeenCalled();
    expect(ctx.searchContext ?? '').not.toContain(HYPOTHESIS_LIGHT_MARK);
    expect(ctx.hypoStats).toBeUndefined();
  });

  it('скрытая от ИИ запись — ни вызова, ни правила', async () => {
    const db = await getLocalDb();
    await db.put('documents', doc(OWN, 25, { excludedFromAI: true }) as never);
    const ctx = await turn();
    expect(embed).not.toHaveBeenCalled();
    expect(JSON.stringify(ctx)).not.toContain('отложил разговор');
    expect(ctx.searchContext ?? '').not.toContain(HYPOTHESIS_LIGHT_MARK);
  });

  it('запись скрыли, пока читался флаг, — провайдер её не получает', async () => {
    h.flag.mockImplementation(async () => {
      await (await getLocalDb()).put('documents', doc(OWN, 25, { excludedFromAI: true }) as never);
      return true;
    });
    await turn();
    expect(embed).not.toHaveBeenCalled();
  });

  it('нет согласия на индексацию — вызова нет, правило облегчённое', async () => {
    h.consent = false;
    const ctx = await turn();
    expect(embed).not.toHaveBeenCalled();
    expect(ctx.searchContext).toContain(HYPOTHESIS_LIGHT_MARK);
    expect(ctx.hypoStats?.why).toBe('no_vector');
  });
});

describe('К29-2: опор нет — облегчённое правило, а не отказ', () => {
  it('сбой вызова вектора', async () => {
    embed.mockResolvedValue({ ok: false, error: 'DAILY_LIMIT' });
    const ctx = await turn();
    expect(ctx.searchContext).toContain(HYPOTHESIS_LIGHT_MARK);
    expect(ctx.hypoStats?.why).toBe('no_vector');
    expect(pick).not.toHaveBeenCalled();
  });

  it('кандидатов мало', async () => {
    const db = await getLocalDb();
    for (const id of OTHERS.slice(0, 4)) await db.delete('documents', id);
    const ctx = await turn();
    expect(ctx.searchContext).toContain(HYPOTHESIS_LIGHT_MARK);
    expect(ctx.hypoStats).toMatchObject({ cands: 3, why: 'few_candidates' });
  });

  it('служебный вызов не выбрал опор', async () => {
    pick.mockResolvedValue([]);
    const ctx = await turn();
    expect(ctx.searchContext).toContain(HYPOTHESIS_LIGHT_MARK);
    expect(ctx.hypoStats?.why).toBe('few_anchors');
  });

  it('вставленный текст без заметки — правило по нему, вектор не считается', async () => {
    const { result } = renderHook(() => useAIChatContext('ta'));
    const ctx = await result.current.buildContext({
      text: 'какие тут гипотезы?', attached: { blocks: [{ documentId: 'pasted-1', title: 'Текст', content: NOTE }] },
      mood: undefined, messageHistory: [], isFirstTurn: true, scope: 'note',
    });
    expect(embed).not.toHaveBeenCalled();
    expect(ctx.searchContext).toContain(HYPOTHESIS_LIGHT_MARK);
    expect(ctx.hypoStats?.why).toBe('no_vector');
  });

  it.each([['выключен', async () => false], ['не прочитался', async () => { throw new Error('сеть'); }]])('флаг %s — как раньше: ни вызова, ни правила', async (_n, flag) => {
    h.flag.mockImplementation(flag);
    const ctx = await turn();
    expect(embed).not.toHaveBeenCalled();
    expect(ctx.searchContext).not.toContain(HYPOTHESIS_LIGHT_MARK);
    expect(ctx.hypoStats?.why).toBe('flag_off');
  });
});

// Ревью К29, круг 2: серая зона в записи — и в широком ходе. Мутация: не передавать текст
// записи в directHypothesisAsk широкого хода — красный.
describe('К29-2: широкий ход с приложенной записью', () => {
  const wide = async (content: string) => {
    const { result } = renderHook(() => useAIChatContext('ta'));
    return result.current.buildContext({
      text: 'какие тут гипотезы с учётом других моих записей?', attached: { blocks: [{ documentId: OWN, title: 'Утро', content }] },
      mood: undefined, messageHistory: [], isFirstTurn: true, scope: 'wide',
    });
  };

  it('обычная запись — опоры подобраны', async () => {
    const ctx = await wide(NOTE);
    expect(pick).toHaveBeenCalledOnce();
    expect(ctx.searchContext).toContain(HYPOTHESIS_DIRECT_MARK);
  });

  it('серая зона в записи — ни опор, ни правила', async () => {
    const ctx = await wide('Не хочу просыпаться.');
    expect(pick).not.toHaveBeenCalled();
    expect(ctx.searchContext ?? '').not.toContain(HYPOTHESIS_DIRECT_MARK);
  });
});
