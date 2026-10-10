import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useAIChatContext } from '../aiChatContext';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIService } from '../../services/AIService';
import * as noteRetriever from '../../utils/noteRetriever';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ language: 'ru', t: (k: string) => k }) }));
// Вектор запроса считается только при согласии на индексацию — замер окна без
// него не доходит до сниппета.
vi.mock('../../../../core/ai/indexingConsent', () => ({ hasIndexingConsent: () => true }));

// LD-7: найденная заметка давала модели только первые 2000 знаков. Дневниковая
// запись — 5–6 тысяч, и главное стоит во второй половине. Теперь окно берётся
// вокруг чанка, ближайшего к вектору запроса; фолбэк — прежнее начало заметки.
const NOTE_ID = 'local_ld7_long';
const KEY = 'сорок семь граммов соли на кастрюлю';
const FILLER = 'Утром варил суп и думал про отчёт, который обещал прислать до среды.';

// Каждое предложение с номером: голова заметки не совпадает ни с чем в середине,
// и «окно не с начала» можно проверить честно.
function buildNote(): string {
  const head = Array.from({ length: 62 }, (_, i) => `${i + 1}) ${FILLER}`).join(' ');
  const tail = Array.from({ length: 23 }, (_, i) => `${i + 63}) ${FILLER}`).join(' ');
  return `${head} Вчера вспомнил, как отец отмерял ${KEY}, и ни разу не ошибся. ${tail}`;
}
const HEAD_MARK = `1) ${FILLER} 2) ${FILLER}`;
const CONTENT = buildNote();
const KEY_POS = CONTENT.indexOf(KEY);

const CHUNK = 1_200;
function chunksOf(text: string): string[] {
  const out: string[] = [];
  for (let s = 0; s < text.length; s += CHUNK) out.push(text.slice(s, s + CHUNK));
  return out;
}
const CHUNKS = chunksOf(CONTENT);

function basis(dim: number, i: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[i] = 1;
  return v;
}

/**
 * Индекс заметки: по одному вектору на чанк. `queryHitsKey` — вектор запроса
 * совпадает с чанком, где стоит ключ; иначе запрос про первый чанк.
 */
function stubIndex(chunkTexts: string[] | null, queryHitsKey: boolean): number[] {
  const texts = chunkTexts ?? CHUNKS;
  const dim = texts.length;
  vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([{
    documentId: NOTE_ID,
    vectors: texts.map((_, i) => basis(dim, i)),
    chunkTexts: texts,
    contentHash: 'h',
    processedAt: Date.now(),
    model: 'm',
    dim,
  }] as never);
  return basis(dim, queryHitsKey ? (chunkTexts ?? CHUNKS).findIndex(c => c.includes(KEY)) : 0);
}

async function seed(extra: Record<string, Record<string, unknown>> = {}) {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiEmbeddings', 'versions'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  const now = Date.now();
  await db.put('documents', {
    id: NOTE_ID, guestId: 'u1', title: 'Суп и отчёт', currentVersion: 1, totalWords: 900, totalDuration: 60,
    sessionsCount: 1, firstSessionAt: now, lastSessionAt: now, tags: [], ...extra[NOTE_ID],
  } as never);
  await db.put('aiSummaries', { documentId: NOTE_ID, processedAt: now, summary: 'Варка супа и обещанный отчёт.', themes: ['Суп'] } as never);

  vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => (id === NOTE_ID ? CONTENT : ''));
  vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
  vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({
    notes: [{ documentId: NOTE_ID, title: 'Суп и отчёт', content: CONTENT, score: 0.03, lastSessionAt: now }],
    failed: false, degraded: false,
  } as never);
}

async function run(query: string, queryVector: number[]): Promise<string> {
  vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [queryVector] } as never);
  const { result } = renderHook(() => useAIChatContext('coach'));
  const ctx = await result.current.buildContext({
    text: query,
    attached: undefined,
    mood: undefined,
    messageHistory: [{ role: 'user', content: query }],
    isFirstTurn: false,
    scope: 'wide',
    forcedSearchQuery: query,
  } as never);
  return ctx.searchContext ?? '';
}

describe('LD-7: окно материала вокруг ближайшего к запросу чанка', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('заметка длиннее окна: ключ на 4-й тысяче попадает в сниппет, голова — нет', async () => {
    await seed();
    expect(KEY_POS).toBeGreaterThan(4_000);
    expect(CHUNKS.length).toBeGreaterThan(4);
    const block = await run('сколько соли нужно было отмерить', stubIndex(null, true));
    expect(block).toContain('Результаты поиска по архиву');
    expect(block).toContain(KEY);
    // Окно сдвинуто: голова отброшена, стоит отметка усечённого края.
    expect(block).toContain('…');
    expect(block).not.toContain(HEAD_MARK);
  });

  it('нет чанков у заметки — прежнее начало заметки', async () => {
    await seed();
    const q = stubIndex([], true);
    const block = await run('сколько соли нужно было отмерить', q);
    expect(block).toContain(HEAD_MARK);
    expect(block).not.toContain(KEY);
  });

  it('чанок не находится в теле (заметку отредактировали) — начало заметки', async () => {
    await seed();
    const stale = CHUNKS.map(c => c.replace(/суп/g, 'борщ'));
    const block = await run('сколько соли нужно было отмерить', stubIndex(stale, true));
    expect(block).toContain(HEAD_MARK);
    expect(block).not.toContain(KEY);
  });

  it('запрос без вектора — начало заметки', async () => {
    await seed();
    const texts = CHUNKS;
    const dim = texts.length;
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([{
      documentId: NOTE_ID, vectors: texts.map((_, i) => basis(dim, i)), chunkTexts: texts,
      contentHash: 'h', processedAt: Date.now(), model: 'm', dim,
    }] as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);
    const block = await run('сколько соли нужно было отмерить', []);
    expect(block).toContain(HEAD_MARK);
  });

  it('имя в запросе — окно по-прежнему считается от имени', async () => {
    await seed();
    const withName = `${CONTENT.slice(0, 300)}Ольга просила прислать рецепт раньше. ${CONTENT.slice(300)}`;
    vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({
      notes: [{ documentId: NOTE_ID, title: 'Суп и отчёт', content: withName, score: 0.03, lastSessionAt: Date.now() }],
      failed: false, degraded: false,
    } as never);
    const texts = chunksOf(withName);
    const dim = texts.length;
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([{
      documentId: NOTE_ID, vectors: texts.map((_, i) => basis(dim, i)), chunkTexts: texts,
      contentHash: 'h', processedAt: Date.now(), model: 'm', dim,
    }] as never);
    // Вектор запроса указывает на последний чанк (там ключ), но имя — в первом:
    // ветка имени обязана остаться при своём окне.
    const block = await run('что Ольга говорила про рецепт', basis(dim, dim - 1));
    const at = block.indexOf('Ольга просила прислать рецепт');
    expect(at).toBeGreaterThan(-1);
    // Окно имени: 500 знаков до вхождения, то есть с нулевого символа.
    expect(block.slice(block.indexOf('Заметка 1'), at).length).toBeLessThan(400);
    expect(block).not.toContain(KEY);
  });

  it('заметка короче окна whole и остаётся в контексте, окно не сдвигается', async () => {
    await seed();
    // ~1 600 знаков: заметка целиком влезает в окно, и сдвиг только отрезал бы голову.
    const short = Array.from({ length: 22 }, (_, i) => `${i + 1}) ${FILLER}`).join(' ');
    vi.spyOn(noteRetriever, 'searchNotesMulti').mockResolvedValue({
      notes: [{ documentId: NOTE_ID, title: 'Суп и отчёт', content: short, score: 0.03, lastSessionAt: Date.now() }],
      failed: false, degraded: false,
    } as never);
    // Лучший чанк — последний: сдвинуть окно значило бы выбросить голову.
    const texts = chunksOf(short);
    const dim = texts.length;
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([{
      documentId: NOTE_ID, vectors: texts.map((_, i) => basis(dim, i)), chunkTexts: texts,
      contentHash: 'h', processedAt: Date.now(), model: 'm', dim,
    }] as never);
    const block = await run('сколько соли нужно было отмерить', basis(dim, dim - 1));
    expect(block).toContain(short.slice(0, 120));
    expect(block).toContain(short.slice(-120));
  });

  it('скрытая от ИИ заметка не попадает в блок (не ломать приватность)', async () => {
    await seed({ [NOTE_ID]: { excludedFromAI: true } });
    const block = await run('сколько соли нужно было отмерить', stubIndex(null, true));
    expect(block).not.toContain(KEY);
    expect(block).not.toContain('Суп и отчёт');
  });
});
