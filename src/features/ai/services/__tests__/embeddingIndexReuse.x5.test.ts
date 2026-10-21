import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { useAIChatContext } from '../aiChatContext';
import { AIService } from '../AIService';
import { AIProfileService } from '../AIProfileService';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { invalidateMiniSearchCache } from '../../utils/noteRetriever';
import { isExcludedFromAI } from '../../utils/isExcludedFromAI';

// X-5: векторный индекс перечитывался с нуля на каждый ход. Здесь считается
// число обращений к IndexedDB за ход и проверяется, что сброс кэша следует за
// каждым изменением стора.
const USER = 'u_x5_index';
const VECTOR = [0.9, 0.1, 0.0];
const NOTE_COUNT = 8;

vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: USER }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const calls: Record<string, number> = {};
function bump(key: string): void { calls[key] = (calls[key] ?? 0) + 1; }

type StoreMethods = {
  get: (key: IDBValidKey) => IDBRequest;
  getAll: (query?: IDBKeyRange | null, count?: number) => IDBRequest;
  getAllKeys: (query?: IDBKeyRange | null, count?: number) => IDBRequest;
  __instrumented?: boolean;
};

function instrumentIdb(): void {
  const proto = IDBObjectStore.prototype as unknown as StoreMethods & { name: string };
  if (proto.__instrumented) return;
  const origGet = proto.get;
  const origGetAll = proto.getAll;
  const origGetAllKeys = proto.getAllKeys;
  const wrap = <A extends unknown[]>(orig: (this: unknown, ...a: A) => unknown, tag: string) =>
    function (this: { name: string }, ...a: A) {
      bump(`${tag}:${this.name}`);
      return orig.apply(this, a);
    };
  proto.get = wrap(origGet, 'get') as StoreMethods['get'];
  proto.getAll = wrap(origGetAll, 'getAll') as StoreMethods['getAll'];
  proto.getAllKeys = wrap(origGetAllKeys, 'getAllKeys') as StoreMethods['getAllKeys'];
  (proto as { __instrumented?: boolean }).__instrumented = true;
}

async function turn(text: string) {
  const { result } = renderHook(() => useAIChatContext('editor'));
  return result.current.buildContext({
    text, attached: null, mood: undefined, messageHistory: [], isFirstTurn: false,
  });
}

async function seed(): Promise<void> {
  const db = await getLocalDb();
  for (const store of ['documents', 'versions', 'aiSummaries', 'aiEmbeddings'] as const) {
    for (const rec of await db.getAll(store)) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key);
    }
  }
  const now = Date.now();
  for (let i = 0; i < NOTE_COUNT; i++) {
    const id = `doc_x5_${i}`;
    const text = `Текст заметки ${i} про утренний бег и обещания себе`;
    await db.put('documents', {
      id, guestId: USER, title: `Заметка ${i}`, currentVersion: 1,
      totalWords: 30, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: now - i * 86_400_000, lastSessionAt: now - i * 86_400_000, tags: [],
    } as never);
    await db.put('aiSummaries', { documentId: id, summary: `Разбор заметки ${i}. `.repeat(12), processedAt: now - i } as never);
    await AIEmbeddingService.save({
      documentId: id, vectors: [VECTOR, VECTOR], chunkTexts: [text, `${text} (кусок 2)`],
      model: 'test', dim: 3, contentHash: `hash-${i}`, processedAt: now - i,
    });
  }
}

describe('X-5: индекс векторов не перечитывается каждый ход', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    instrumentIdb();
    invalidateMiniSearchCache();
    setIndexingConsent(USER, 'granted');
    vi.spyOn(AIProfileService, 'getPortrait').mockResolvedValue(null);
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) => {
      const i = Number(id.replace('doc_x5_', ''));
      return Number.isNaN(i) ? '' : `Текст заметки ${i} про утренний бег и обещания себе`;
    });
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [VECTOR], chunks: ['t'], model: 'test', dim: 3 });
    await seed();
  });

  it('второй ход не поднимает стор эмбеддингов заново', async () => {
    Object.keys(calls).forEach(k => delete calls[k]);
    await turn('что я писал про утренний бег?');
    const first = { ...calls };
    expect(first['getAll:aiEmbeddings'] ?? 0, 'первый ход обязан прочитать индекс').toBeGreaterThan(0);

    Object.keys(calls).forEach(k => delete calls[k]);
    const ctx = await turn('а что я писал про утренний бег вчера?');
    const second = { ...calls };

    expect(second['getAll:aiEmbeddings'] ?? 0, 'второй ход снова тащит весь векторный стор').toBe(0);
    expect(second['get:aiEmbeddings'] ?? 0, 'второй ход читает эмбеддинги по одному').toBe(0);
    // Сверка набора ключей — дешёвый обход без векторов, он и есть страховка
    // от писателей, которые обходятся мимо кэша.
    expect(second['getAllKeys:aiEmbeddings'] ?? 0, 'сверка ключей должна оставаться одной').toBe(1);
    // Поиск по вопросу о заметке больше не делает точечное чтение на кандидата.
    expect(second['get:documents'] ?? 0, `точечных чтений документов: ${second['get:documents']}`).toBeLessThan(3);
    expect(ctx.searchContext ?? '').toContain('Заметка');
  });

  it('заметка, скрытая от ИИ после загрузки индекса, в следующий ход не возвращается', async () => {
    await turn('что я писал про утренний бег?');
    const db = await getLocalDb();
    const hiddenId = 'doc_x5_0';
    const doc = await db.get('documents', hiddenId);
    await db.put('documents', { ...doc, excludedFromAI: true } as never);
    invalidateMiniSearchCache();

    const ctx = await turn('что я писал про утренний бег?');
    const context = ctx.searchContext ?? '';
    expect(isExcludedFromAI({ excludedFromAI: true } as never), 'страховка: признак читается').toBe(true);
    expect(context, 'скрытая заметка уехала в контекст').not.toContain('Текст заметки 0');
    expect(context).toContain('Заметка 1');
  });

  it('запись и удаление эмбеддинга сбрасывают кэш индекса', async () => {
    const warm = await AIEmbeddingService.getAll();
    expect(warm).toHaveLength(NOTE_COUNT);

    await (await getLocalDb()).put('documents', {
      id: 'doc_x5_new', guestId: USER, title: 'Новая', currentVersion: 1, totalWords: 3,
      totalDuration: 0, sessionsCount: 1, firstSessionAt: Date.now(), lastSessionAt: Date.now(), tags: [],
    } as never);
    await AIEmbeddingService.save({
      documentId: 'doc_x5_new', vectors: [VECTOR], chunkTexts: ['Новая заметка про бег'],
      model: 'test', dim: 3, contentHash: 'hash-new', processedAt: Date.now(),
    });
    const afterSave = await AIEmbeddingService.getAll();
    expect(afterSave.map(e => e.documentId), 'новая запись не попала в индекс').toContain('doc_x5_new');

    await AIEmbeddingService.delete('doc_x5_new');
    const afterDelete = await AIEmbeddingService.getAll();
    expect(afterDelete.map(e => e.documentId), 'удалённая запись осталась в индексе').not.toContain('doc_x5_new');
  });

  it('правка заметки в другой вкладке: старый текст больше не отдаётся', async () => {
    const warm = await AIEmbeddingService.getAll();
    expect(warm.find(e => e.documentId === 'doc_x5_0')?.chunkTexts?.[0]).toContain('Текст заметки 0');

    // Другая вкладка — свой экземпляр модуля кэша: перевекторизует заметку под тем
    // же ключом (набор ключей не меняется) и сбрасывает СВОЙ кэш.
    const db = await getLocalDb();
    const old = await db.get('aiEmbeddings', 'doc_x5_0');
    await db.put('aiEmbeddings', { ...old!, chunkTexts: ['Абзац удалён'] });
    vi.resetModules();
    const otherTab = await import('../../../../core/services/embeddingIndexCache');
    otherTab.invalidateEmbeddingIndexCache();

    // Точечное чтение — первым: полный обход перестроил бы кэш и скрыл его промах.
    expect(await AIEmbeddingService.get('doc_x5_0').then(e => e?.chunkTexts), 'точечное чтение отдаёт удалённый текст')
      .toEqual(['Абзац удалён']);
    const after = await AIEmbeddingService.getAll();
    const texts = after.find(e => e.documentId === 'doc_x5_0')?.chunkTexts ?? [];
    expect(texts, 'эта вкладка всё ещё отдаёт удалённый текст').toEqual(['Абзац удалён']);
  });
});
