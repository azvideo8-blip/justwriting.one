// 0.9.35: разбор приложенной заметки получает фон из прошлых дней — суть 3–4
// похожих записей с датой и id, отдельным блоком перед заметкой. Разбор живых
// диалогов 09.10: главное, чем выигрывал Claude, — связи с прошлыми днями.
//
// Мутации: убрать фильтр isExcludedFromAI → (b) красный; блок после заметки, а
// не перед ней → (e) красный; без исключения Редактора → (f) красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { buildRelatedDaysBlock } from '../chatContext/relatedDays';
import { useAIChatContext } from '../aiChatContext';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { getLocalDb, type AIDocumentEmbedding, type AIDocumentSummary, type LocalDocument } from '../../../../core/storage/localDb';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 9, 8);
const near = (k: number) => [1, k, 0];
const far = [0, 0, 1];
const emb = (id: string, v: number[]): AIDocumentEmbedding =>
  ({ documentId: id, vectors: [v], model: 'm', dim: 3, contentHash: 'h', processedAt: 0 }) as AIDocumentEmbedding;
const doc = (id: string, daysAgo: number, extra: Partial<LocalDocument> = {}): LocalDocument =>
  ({ id, title: id, currentVersion: 1, lastSessionAt: T0 - daysAgo * DAY, ...extra }) as LocalDocument;
const sum = (id: string, summary: string): AIDocumentSummary =>
  ({ documentId: id, summary, tone: '', frequentWords: [], insights: [], themes: [], extractedFacts: [], processedAt: 0 }) as AIDocumentSummary;

const ATT = 'local_rd_att';
const EMBS = [
  emb(ATT, near(0)),
  emb('local_rd_a', near(0.1)), emb('local_rd_b', near(0.2)), emb('local_rd_c', near(0.3)),
  emb('local_rd_d', near(0.4)), emb('local_rd_e', near(0.05)),
  emb('local_rd_far', far), emb('local_rd_hidden', near(0)), emb('local_rd_trash', near(0)),
  emb('local_rd_nosum', near(0)),
];
const DOCS = new Map<string, LocalDocument>([
  [ATT, doc(ATT, 0)],
  ['local_rd_a', doc('local_rd_a', 5)], ['local_rd_b', doc('local_rd_b', 9)], ['local_rd_c', doc('local_rd_c', 2)],
  ['local_rd_d', doc('local_rd_d', 30)], ['local_rd_e', doc('local_rd_e', 1)],
  ['local_rd_far', doc('local_rd_far', 3)],
  ['local_rd_hidden', doc('local_rd_hidden', 4, { excludedFromAI: true } as Partial<LocalDocument>)],
  ['local_rd_trash', doc('local_rd_trash', 4, { trashedAt: T0 } as Partial<LocalDocument>)],
  ['local_rd_nosum', doc('local_rd_nosum', 6)],
]);
const SUMS = new Map<string, AIDocumentSummary>(
  ['local_rd_a', 'local_rd_b', 'local_rd_c', 'local_rd_d', 'local_rd_e', 'local_rd_far', 'local_rd_hidden', 'local_rd_trash']
    .map(id => [id, sum(id, `СУТЬ_${id}`)]),
);

describe('фон из прошлых дней: отбор', () => {
  it('(a) похожие — до четырёх, по датам; далёкая по теме не берётся', () => {
    const r = buildRelatedDaysBlock(ATT, EMBS, DOCS, SUMS)!;
    expect(r.ids).toHaveLength(4);
    expect(r.ids).not.toContain('local_rd_far');
    expect(r.ids).not.toContain(ATT);
    // четвёрка самых похожих: e, a, b, c (d — пятая); порядок — по датам
    expect(r.ids).toEqual(['local_rd_b', 'local_rd_a', 'local_rd_c', 'local_rd_e']);
    expect(r.block).toContain('НЕ эта заметка');
  });

  it('(b) скрытая от ИИ и выброшенная не называются даже сутью', () => {
    const r = buildRelatedDaysBlock(ATT, EMBS, DOCS, SUMS)!;
    expect(r.block).not.toContain('СУТЬ_local_rd_hidden');
    expect(r.block).not.toContain('СУТЬ_local_rd_trash');
    expect(r.ids).not.toContain('local_rd_hidden');
  });

  it('(c) без готового разбора заметка не берётся: сырого текста в фоне нет', () => {
    expect(buildRelatedDaysBlock(ATT, EMBS, DOCS, SUMS)!.ids).not.toContain('local_rd_nosum');
  });

  it('(d) у приложенной заметки нет вектора — фона нет', () => {
    expect(buildRelatedDaysBlock(ATT, EMBS.filter(e => e.documentId !== ATT), DOCS, SUMS)).toBeNull();
  });
});

describe('фон из прошлых дней: относительная дата строки (DR-3)', () => {
  const local = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
  const pair = (noteAt: number | undefined, relAt: number) => {
    const docs = new Map<string, LocalDocument>([
      ['att', { id: 'att', title: 'att', currentVersion: 1, ...(noteAt ? { lastSessionAt: noteAt } : {}) } as unknown as LocalDocument],
      ['rel', { id: 'rel', title: 'rel', currentVersion: 1, lastSessionAt: relAt } as unknown as LocalDocument],
    ]);
    const summaries = new Map<string, AIDocumentSummary>([['rel', sum('rel', 'СУТЬ_rel')]]);
    const embeddings = [emb('att', near(0)), emb('rel', near(0.1))];
    return buildRelatedDaysBlock('att', embeddings, docs, summaries)!.block;
  };

  it('двумя днями раньше → «за 2 дн. до этой заметки»', () => {
    expect(pair(local(2026, 10, 9), local(2026, 10, 7))).toContain('· за 2 дн. до этой заметки]');
  });

  it('тот же локальный день при разных часах → «в тот же день»', () => {
    expect(pair(local(2026, 10, 9, 8, 15), local(2026, 10, 9, 22, 40))).toContain('· в тот же день]');
  });

  it('тремя днями позже → «через 3 дн. после этой заметки»', () => {
    expect(pair(local(2026, 10, 9), local(2026, 10, 12))).toContain('· через 3 дн. после этой заметки]');
  });

  // Мутация «считать по UTC-дням»: 23:30 и 00:30 следующих суток — один и тот же
  // UTC-день, метка станет «в тот же день» и порядок дней перевернётся.
  it('граница суток: 23:30 и 00:30 следующих локальных суток → один день', () => {
    expect(pair(local(2026, 10, 9, 23, 30), local(2026, 10, 10, 0, 30))).toContain('· через 1 дн. после этой заметки]');
  });

  it('у приложенной заметки нет даты → метки нет, строка как была', () => {
    const block = pair(undefined, local(2026, 10, 7));
    expect(block).toMatch(/\[#rel · \d{4}-\d{2}-\d{2}\] СУТЬ_rel/);
    expect(block).not.toContain('дн. до');
    expect(block).not.toContain('тот же день');
  });

  it('метрика считается по локальным суткам, а не по разнице в мс', () => {
    // Ровно 24 часа разницы при 20:00 → 20:00: сутки, а не «тот же день».
    expect(pair(local(2026, 10, 9, 20), local(2026, 10, 10, 20))).toContain('· через 1 дн. после этой заметки]');
  });
});

describe('фон из прошлых дней: строгий ход', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue(EMBS);
    const db = await getLocalDb();
    for (const d of DOCS.values()) await db.put('documents', d as never);
    for (const s of SUMS.values()) await db.put('aiSummaries', s as never);
  });

  async function strict(personaId: string) {
    const { result } = renderHook(() => useAIChatContext(personaId));
    return result.current.buildContext({
      text: 'разбери глубоко',
      attached: { documentId: ATT, content: 'ТЕКСТ_ПРИЛОЖЕННОЙ_ЗАМЕТКИ' },
      mood: undefined,
      messageHistory: [],
      isFirstTurn: true,
      scope: 'note',
    });
  }

  it('(e) блок фона стоит перед заметкой, заметка — последней; ссылки разрешены', async () => {
    const ctx = await strict('group_psychology');
    const sc = ctx.searchContext ?? '';
    expect(sc).toContain('СУТЬ_local_rd_a');
    expect(sc.indexOf('Другие дни')).toBeLessThan(sc.indexOf('ТЕКСТ_ПРИЛОЖЕННОЙ_ЗАМЕТКИ'));
    expect(ctx.injectedDocumentIds).toContain('local_rd_a');
    expect(sc).not.toContain('Результаты поиска');
  });

  it('(f) Редактору фон не даётся', async () => {
    const ctx = await strict('editor');
    expect(ctx.searchContext ?? '').not.toContain('Другие дни');
  });
});
