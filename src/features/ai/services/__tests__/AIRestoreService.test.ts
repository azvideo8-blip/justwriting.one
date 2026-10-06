import { describe, it, expect, vi, beforeEach } from 'vitest';

const localStore: {
  aiSummaries: Map<string, unknown>;
  aiEmbeddings: Map<string, unknown>;
  aiTimeline: Map<string, unknown>;
  documents: Map<string, unknown>;
  aiPortrait: Map<string, unknown>;
  aiDialogues: Map<string, unknown>;
  aiProfileFacets: Map<string, unknown>;
  lifeStory: Map<string, unknown>;
} = {
  aiSummaries: new Map(),
  aiEmbeddings: new Map(),
  aiTimeline: new Map(),
  documents: new Map(),
  aiPortrait: new Map(),
  aiDialogues: new Map(),
  aiProfileFacets: new Map(),
  lifeStory: new Map(),
};
type StoreName = keyof typeof localStore;

vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(async () => ({
    objectStoreNames: {
      contains: (s: string) => s in localStore,
    },
    getAllKeys: async (store: StoreName) => [...(localStore[store]?.keys() ?? [])],
    getAll: async (store: StoreName) => [...(localStore[store]?.values() ?? [])],
    get: async (store: StoreName, key: string) => localStore[store]?.get(key),
    put: async (store: StoreName, value: { documentId?: string; id?: string; eventDate?: string }) => {
      const key = (value.documentId ?? value.id ?? value.eventDate)!;
      if (localStore[store] === undefined) localStore[store] = new Map();
      localStore[store].set(key, value);
    },
    delete: async (store: StoreName, key: string) => {
      localStore[store]?.delete(key);
    },
    // S-35: диалоги сливаются внутри одной readwrite-транзакции.
    transaction: (store: StoreName) => ({
      store: {
        get: async (key: string) => localStore[store]?.get(key),
        put: async (value: { id: string }) => { localStore[store].set(value.id, value); },
      },
      done: Promise.resolve(),
    }),
  })),
}));

const latestContent = new Map<string, string>();
vi.mock('../../../../core/services/LocalVersionService', () => ({
  LocalVersionService: {
    getLatestContent: async (id: string) => latestContent.get(id) ?? '',
  },
}));

vi.mock('../../utils/embeddingIndexer', () => ({
  sha256Hex: async (text: string) => `hash-of:${text}`,
}));

vi.mock('../AIThemeLedgerService', () => ({ enqueuePendingThemeTouch: vi.fn() }));

const summaryDocs: Array<{ id: string; data: () => unknown }> = [];
const embeddingDocs: Array<{ id: string; data: () => unknown }> = [];
const localStoreRecordsDocs: Array<{ store: string; key: string; payload: Record<string, unknown>; checksum?: string; stamped_at?: number }> = [];
const providerCalls: Array<[string, unknown[]]> = [];
// W-5: последние два факта забора local_store_records — с какой отметки пошли в
// облако и сколько строк оттуда приехало.
const lastPull = { since: null as number | null, rowsReturned: -1 };

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getUserSummaries: async (...a: unknown[]) => { providerCalls.push(['summaries', a]); return summaryDocs.map(d => ({ id: d.id, ...(d.data() as any) })); },
    getUserEmbeddingsPaginated: async (_uid: string, limit: number, cursor?: string) => {
      providerCalls.push(['embeddings', [_uid]]);
      const all = embeddingDocs;
      const start = cursor ? all.findIndex(d => d.id === cursor) + 1 : 0;
      const slice = all.slice(start, start + limit);
      return {
        items: slice.map(d => ({ id: d.id, ...(d.data() as any) })),
        nextCursorId: slice.length === limit ? slice[slice.length - 1]?.id ?? null : null,
        readCount: slice.length,
      };
    },
    getLocalStoreRecords: async (...a: unknown[]) => {
      providerCalls.push(['localStore', a]);
      // Как настоящий провайдер (providers/localStore.ts): инкрементальный забор
      // фильтрует по СЕРВЕРНОЙ отметке строки.
      const since = typeof a[2] === 'number' ? a[2] : undefined;
      lastPull.since = since ?? null;
      const out = since === undefined
        ? localStoreRecordsDocs
        : localStoreRecordsDocs.filter(r => r.stamped_at === undefined || r.stamped_at > since);
      lastPull.rowsReturned = out.length;
      return out;
    },
  },
}));

const getSessionKey = vi.fn(() => ({} as CryptoKey));
vi.mock('../../../../core/crypto/encrypt', () => ({ getSessionKey: () => getSessionKey() }));

const getEncryptionEnabled = vi.fn((_uid: string) => true);
const maybeDecrypt = vi.fn(async (doc: Record<string, unknown>, _strFields?: string[], _arrFields?: string[]) => doc);
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: (uid: string) => getEncryptionEnabled(uid),
  maybeDecrypt: (doc: Record<string, unknown>, strFields?: string[], arrFields?: string[]) => maybeDecrypt(doc, strFields, arrFields),
}));

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../shared/errors/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_reattach' }) }));

const decodeCloudSummary = vi.fn(async (d: Record<string, unknown>, id: string) => ({ documentId: id, tone: d.tone }));
vi.mock('../AISummaryService', () => ({
  decodeCloudSummary: (d: Record<string, unknown>, id: string) => decodeCloudSummary(d, id),
}));

const decodeCloudEmbedding = vi.fn(async (_d: Record<string, unknown>, id: string) => ({ documentId: id, vectors: [[1]] }));
vi.mock('../AIEmbeddingService', () => ({
  decodeCloudEmbedding: (d: Record<string, unknown>, id: string) => decodeCloudEmbedding(d, id),
}));

import { restoreAIDataFromCloud, reattachOrphanedAnalysis, requestEmbeddingRestore } from '../AIRestoreService';
import { nextPullCursor } from '../pullCursor';
import { reportError } from '../../../../shared/errors/reportError';
import { logger } from '../../../../shared/errors/logger';
import { MAX_RESTORE_RECORD_BYTES } from '../../../../core/services/LocalStoreSyncService';

describe('restoreAIDataFromCloud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStore.aiSummaries = new Map();
    localStore.aiEmbeddings = new Map();
    localStore.aiTimeline = new Map();
    localStore.documents = new Map();
    localStore.aiPortrait = new Map();
    localStore.aiDialogues = new Map();
    localStore.aiProfileFacets = new Map();
    localStore.lifeStory = new Map();
    latestContent.clear();
    summaryDocs.length = 0;
    embeddingDocs.length = 0;
    localStoreRecordsDocs.length = 0;
    lastPull.since = null;
    lastPull.rowsReturned = -1;
    lastPull.since = null;
    lastPull.rowsReturned = -1;
    getSessionKey.mockReturnValue({} as CryptoKey);
    getEncryptionEnabled.mockReturnValue(true);
    // Pulling embeddings is opt-in: the collection costs more read units than a
    // whole free day. These cases exercise the restore itself, so they opt in.
    requestEmbeddingRestore('user_1');
    requestEmbeddingRestore('user-a');
  });

  // Разбор с компьютера доезжал до ноутбука только на следующий день: полный
  // забор шёл раз в сутки. Инкрементальный — каждый фоновый проход.
  it('incremental pull asks the cloud only for changes since the cursor and skips vectors', async () => {
    providerCalls.length = 0;
    requestEmbeddingRestore('user_1');
    await restoreAIDataFromCloud('user_1', { sinceMs: 1_790_000_000_000 });
    expect(providerCalls).toContainEqual(['summaries', ['user_1', 1_790_000_000_000]]);
    expect(providerCalls).toContainEqual(['localStore', ['user_1', undefined, 1_790_000_000_000]]);
    expect(providerCalls.some(([k]) => k === 'embeddings')).toBe(false);
  });

  // Повторный разбор заметки на компьютере не доезжал до ноутбука: любой
  // локальный разбор блокировал облачный навсегда, без сравнения времени.
  it('replaces an older local analysis with a newer cloud one, and keeps a newer local one', async () => {
    localStore.documents.set('local_n', { id: 'local_n', uuid: 'uuid-n', lastSessionAt: 1000 });
    localStore.aiSummaries.set('local_n', { documentId: 'local_n', documentUuid: 'uuid-n', tone: 'old', processedAt: 100 });
    decodeCloudSummary.mockImplementation(async (d: Record<string, unknown>, id: string) => ({
      documentId: id, documentUuid: 'uuid-n', tone: d.tone, processedAt: d.processedAt,
    }));
    summaryDocs.push({ id: 'uuid-n', data: () => ({ tone: 'new', processedAt: 200 }) });

    await restoreAIDataFromCloud('user_1', { sinceMs: 0 });
    expect(localStore.aiSummaries.get('local_n')).toMatchObject({ tone: 'new', processedAt: 200 });
    expect(localStore.aiSummaries.has('uuid-n')).toBe(false);

    summaryDocs.length = 0;
    summaryDocs.push({ id: 'uuid-n', data: () => ({ tone: 'stale', processedAt: 150 }) });
    await restoreAIDataFromCloud('user_1', { sinceMs: 0 });
    expect(localStore.aiSummaries.get('local_n')).toMatchObject({ tone: 'new' });
  });

  it('restores local_store_records (aiPortrait, aiDialogues, lifeStory) when missing locally', async () => {
    localStoreRecordsDocs.push({
      store: 'aiPortrait',
      key: 'singleton',
      payload: { data: JSON.stringify({ id: 'singleton', portrait: 'Cloud Portrait', updatedAt: 2000 }) },
    });
    localStoreRecordsDocs.push({
      store: 'lifeStory',
      key: '2026-08-19',
      payload: { data: JSON.stringify({ eventDate: '2026-08-19', text: 'Story entry', generatedAt: 2000 }) },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(2);
    expect(localStore.aiPortrait.get('singleton')).toMatchObject({ portrait: 'Cloud Portrait' });
    expect(localStore.lifeStory.get('2026-08-19')).toMatchObject({ text: 'Story entry' });
  });

  it('preserves local record when local timestamp is newer or equal to cloud', async () => {
    localStore.aiPortrait.set('singleton', { id: 'singleton', portrait: 'Local Newer', updatedAt: 5000 });
    localStoreRecordsDocs.push({
      store: 'aiPortrait',
      key: 'singleton',
      payload: { data: JSON.stringify({ id: 'singleton', portrait: 'Cloud Older', updatedAt: 3000 }) },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(0);
    expect(localStore.aiPortrait.get('singleton')).toMatchObject({ portrait: 'Local Newer' });
  });

  it('strictly preserves local record when either local or cloud lacks a timestamp', async () => {
    // Local has no timestamp field!
    localStore.aiPortrait.set('singleton', { id: 'singleton', portrait: 'Local Untimestamped' });
    localStoreRecordsDocs.push({
      store: 'aiPortrait',
      key: 'singleton',
      payload: { data: JSON.stringify({ id: 'singleton', portrait: 'Cloud Timestamped', updatedAt: 5000 }) },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(0);
    // Local wins unconditionally!
    expect(localStore.aiPortrait.get('singleton')).toMatchObject({ portrait: 'Local Untimestamped' });
  });

  it('overwrites local record only when both timestamps exist and cloud is newer', async () => {
    localStore.aiPortrait.set('singleton', { id: 'singleton', portrait: 'Local Older', updatedAt: 1000 });
    localStoreRecordsDocs.push({
      store: 'aiPortrait',
      key: 'singleton',
      payload: { data: JSON.stringify({ id: 'singleton', portrait: 'Cloud Newer', updatedAt: 6000 }) },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(1);
    expect(localStore.aiPortrait.get('singleton')).toMatchObject({ portrait: 'Cloud Newer' });
  });

  // A-5 (R2-012): журнал незакрытых облачных удалений не читается — не знаем,
  // какие из облачных записей уже снесены. Вернуть удалённое хуже, чем не
  // вернуть ничего, поэтому раздел ИИ-записей пропускается целиком.
  it('skips the whole AI-store section when the pending-deletion journal is unreadable', async () => {
    localStorage.setItem('ai_sync_pending_deletes', '{обрывок без закрывающей скобки');
    localStoreRecordsDocs.push({
      store: 'aiPortrait',
      key: 'singleton',
      payload: { data: JSON.stringify({ id: 'singleton', portrait: 'Cloud Portrait', updatedAt: 6000 }) },
    });

    try {
      const res = await restoreAIDataFromCloud('user_1');

      expect(localStore.aiPortrait.size).toBe(0);
      expect(res.localStoreRecords).toBe(0);
      expect(res.sectionFailed).toBe(true);
      expect(reportError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ action: 'restoreAIData_deleteJournalUnknown', userId: 'user_1' }),
        'warning',
      );
    } finally {
      // Остальные кейсы файла читают этот же журнал — оставить его чистым.
      localStorage.removeItem('ai_sync_pending_deletes');
    }
  });

  it('restores assembled record just under MAX_RESTORE_RECORD_BYTES (AG-RESTORE-4)', async () => {    // Large synthetic payload (~9.5 MB)
    const paddingSize = 9.5 * 1024 * 1024;
    const padding = 'x'.repeat(paddingSize);
    const largeObj = { id: 'large-dlg', pad: padding, updatedAt: 3000 };
    const jsonStr = JSON.stringify(largeObj);
    const byteLen = new TextEncoder().encode(jsonStr).length;
    expect(byteLen).toBeLessThan(MAX_RESTORE_RECORD_BYTES);

    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'large-dlg',
      payload: { data: jsonStr, updatedAt: 3000 },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(1);
    expect(res.oversized).toBe(0);
    expect(res.failed).toBe(0);
    expect(localStore.aiDialogues.get('large-dlg')).toMatchObject({ id: 'large-dlg', pad: padding });
  });

  it('maxUpdatedAt = наибольшая внешняя отметка строки, увидленная в облаке', async () => {
    // Курсор инкрементального забора обязан считаться по этой величине, а не по
    // Date.now(): на устройстве с часами вперёд собственные часы «новее» всего,
    // что приходит с сервера, и такой читатель перестал бы получать чужие правки.
    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'cursor-dlg',
      payload: {
        data: JSON.stringify({ id: 'cursor-dlg', title: 'Т', personaId: 'cbt', personaName: 'КПТ', personaEmoji: '🎯', messages: [], createdAt: 1000, updatedAt: 7000 }),
        updatedAt: 7000,
      },
    });
    localStoreRecordsDocs.push({
      store: 'aiPortrait',
      key: 'cursor-portrait',
      payload: { data: JSON.stringify({ id: 'cursor-portrait', updatedAt: 9000 }), updatedAt: 9000 },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.maxUpdatedAt, 'забор не сообщил самую свежую облачную отметку').toBe(9000);
  });

  it('облачная копия с надутыми ВНУТРЕННИМИ часами не выигрывает спор скаляров', async () => {
    // Миграция 0037: сервер переписывает отметку строки, а содержимое `data`
    // непрозрачно (шифр) и сохраняет часы устройства-источника. Если бы спор
    // шел по внутренней отметке, устройство с +сутками держало бы своего
    // собеседника вечно — ровно тот дефект, ради которого всё и затевалось.
    const DAY = 86_400_000;
    const inner = {
      id: 'skew-dlg', title: 'Т', personaId: 'cbt', personaName: 'КПТ', personaEmoji: '🎯',
      messages: [{ id: 'u1', role: 'user', content: 'Общий вопрос', createdAt: 10 }],
      createdAt: 1000, updatedAt: 5000 + DAY, // часы источника убежали на сутки
    };
    localStoreRecordsDocs.push({
      store: 'aiDialogues', key: 'skew-dlg',
      payload: { data: JSON.stringify(inner), updatedAt: 5000 }, // серверная отметка строки — честная
    });
    (localStore.aiDialogues as Map<string, unknown>).set('skew-dlg', {
      id: 'skew-dlg', title: 'Т', personaId: 'group_psychology', personaName: 'Группа', personaEmoji: '🎯',
      messages: [{ id: 'u1', role: 'user', content: 'Общий вопрос', createdAt: 10 }],
      createdAt: 1000, updatedAt: 6000,
    });

    const res = await restoreAIDataFromCloud('user_1');

    const after = localStore.aiDialogues.get('skew-dlg') as { personaId: string; messages: unknown[] };
    expect(after.personaId, 'скаляр утащила копия с убежавшими внутренними часами').toBe('group_psychology');
    expect(after.messages).toHaveLength(1);
    expect(res.maxUpdatedAt, 'курсор обязан считаться по отметке строки, а не по внутренним часам').toBe(5000);
  });

  it('версией записи считает отметку БАЗОВОЙ строки, а не самой свежей в группе', async () => {
    // Отметку окна ставит устройство (сервер переписывает только базовую строку),
    // поэтому курсор и спор копий обязаны смотреть в строку `key`. Если брать
    // первую/самую свежую строку группы, зависимость от порядка сортировки в
    // провайдере станет частью контракта молча.
    const segKey = 'pair-dlg@seg1000-abcd';
    localStoreRecordsDocs.push({
      store: 'aiDialogues', key: segKey,
      payload: {
        seg: true, headKey: 'pair-dlg', firstAt: 1000, lastAt: 1001, updatedAt: 9999,
        messages: JSON.stringify([{ id: 'u1', role: 'user', content: 'Общий вопрос', createdAt: 1000 }]),
      },
    });
    localStoreRecordsDocs.push({
      store: 'aiDialogues', key: 'pair-dlg',
      payload: {
        head: true, title: 'Т', personaName: 'Коуч', personaEmoji: '🎯', updatedAt: 5000,
        createdAt: 1000, closingSummary: '',
        segments: [{ key: segKey, firstAt: 1000, lastAt: 1001, updatedAt: 9999, bytes: 10, count: 1 }],
      },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.maxUpdatedAt, 'курсор уехал за отметку осиротевшего окна').toBe(5000);
    // Здесь проверяется именно выбор строки для версии (head живёт в `key`, окно
    // несёт device-метку). Сборка head + окна покрыт отдельными сюитами
    // (dialogueSegmentUpload.m5, localStoreSyncPaging), принятие серверной отметки
    // локальной копией — dialogueServerStamp.m6.
    const stamps = [...localStore.aiDialogues.values()] as Array<{ updatedAt?: number }>;
    expect(stamps.every(d => d.updatedAt !== 9999), 'отметка окна просочилась в локальную копию как версия').toBe(true);
  });

  it('группа без базовой строки (только осиротевшие окна) курсор не двигает', async () => {
    localStoreRecordsDocs.push({
      store: 'aiDialogues', key: 'orphan-dlg@seg1000-ffff',
      payload: {
        seg: true, headKey: 'orphan-dlg', firstAt: 1000, lastAt: 1001, updatedAt: 77777,
        messages: JSON.stringify([{ id: 'u1', role: 'user', content: 'Сирота', createdAt: 1000 }]),
      },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.maxUpdatedAt, 'осиротевшее окно с device-меткой задёрнуло курсор в будущее').toBe(0);
  });

  // W-5: часы писателя курсором быть не могут. Два дефекта одного корня: чужая
  // запись не доезжает никогда, а после апгрейда один и тот же набор перебирается
  // каждые две минуты.
  it('устройство с часами в +2 ч не прячет от себя чужую запись через 10 минут', async () => {
    const HOUR = 3_600_000;
    const S = 1_777_000_000_000; // серверная отметка моей строки
    const MY_CLOCK = S + 2 * HOUR;
    localStoreRecordsDocs.push({
      store: 'aiPortrait', key: 'skew-mine', stamped_at: S,
      payload: { data: JSON.stringify({ id: 'skew-mine', updatedAt: MY_CLOCK }), updatedAt: MY_CLOCK },
    });

    const first = await restoreAIDataFromCloud('user_1', { sinceMs: S - HOUR });
    expect(first.localStoreRecords).toBe(1);
    expect(first.maxUpdatedAt, 'курсор прыгнул на часы устройства-писателя').toBe(S);
    const cursor = nextPullCursor(MY_CLOCK, S - HOUR, first.maxUpdatedAt);
    expect(cursor, 'после собственного хода курсор уехал в будущее сервера').toBe(S);

    localStoreRecordsDocs.push({
      store: 'aiPortrait', key: 'skew-theirs', stamped_at: S + 10 * 60_000,
      payload: {
        data: JSON.stringify({ id: 'skew-theirs', updatedAt: S + 10 * 60_000 }),
        updatedAt: S + 10 * 60_000,
      },
    });
    const second = await restoreAIDataFromCloud('user_1', { sinceMs: cursor });
    expect(lastPull.rowsReturned, 'чужая строка не попала в выборку').toBe(1);
    expect(second.localStoreRecords).toBe(1);
    expect(localStore.aiPortrait.get('skew-theirs')).toMatchObject({ id: 'skew-theirs' });
  });

  it('строки до миграции 0037 двигают курсор за один проход: второй берёт 0 строк', async () => {
    // Единственный забор после апгрейда: stamped_at у всех строк — время
    // миграции, payload.updatedAt — дни и месяцы до неё, и он старее сохранённого
    // курсора. По payload курсор не ползёт вообще.
    const MIGRATION = 10_000;
    localStoreRecordsDocs.push(
      {
        store: 'aiPortrait', key: 'old-portrait', stamped_at: MIGRATION,
        payload: { data: JSON.stringify({ id: 'old-portrait', updatedAt: 200 }), updatedAt: 200 },
      },
      {
        store: 'lifeStory', key: 'old-story', stamped_at: MIGRATION,
        payload: { data: JSON.stringify({ id: 'old-story', updatedAt: 300 }), updatedAt: 300 },
      },
    );

    const first = await restoreAIDataFromCloud('user_1', { sinceMs: 9_000 });
    expect(lastPull.rowsReturned).toBe(2);
    expect(first.maxUpdatedAt, 'курсор не поднялся на серверную отметку — забор повторяется каждый проход').toBe(MIGRATION);

    const second = await restoreAIDataFromCloud('user_1', { sinceMs: nextPullCursor(Date.now(), 9_000, first.maxUpdatedAt) });
    expect(lastPull.rowsReturned, 'второй проход снова тащит весь набор').toBe(0);
    expect(second.localStoreRecords).toBe(0);
  });

  // R-1: порядок строк у провайдера — (store, key), а `key@seg…` сортируется сразу
  // за `key`. Пока окно считалось кандидатом на «единственную строку записи», оно
  // выигрывало last-writer, `data` в нём отсутствовало, и диалог пропускался на
  // каждом заборе — молча, без роста `failed`.
  it('диалог со строкой `key` и осиротевшим окном рядом доезжает целиком', async () => {
    const cloudCopy = {
      id: 'solo-dlg', title: 'Т', personaId: 'cbt', personaName: 'КПТ', personaEmoji: '🎯',
      messages: [
        { id: 'u1', role: 'user', content: 'Общий вопрос', createdAt: 1000 },
        { id: 'a1', role: 'assistant', content: 'Общий ответ', createdAt: 1001 },
        { id: 'u2', role: 'user', content: 'Вопрос с другого устройства', createdAt: 2000 },
        { id: 'a2', role: 'assistant', content: 'Ответ с другого устройства', createdAt: 2001 },
      ],
      createdAt: 1000, updatedAt: 5000,
    };
    localStoreRecordsDocs.push({
      store: 'aiDialogues', key: 'solo-dlg',
      payload: { data: JSON.stringify(cloudCopy), updatedAt: 5000 },
    });
    localStoreRecordsDocs.push({
      store: 'aiDialogues', key: 'solo-dlg@seg1000-aaaaaaaa',
      payload: {
        seg: true, headKey: 'solo-dlg', firstAt: 1000, lastAt: 1001, updatedAt: 4000,
        messages: JSON.stringify([{ id: 'u9', role: 'user', content: 'Осколок оборванной попытки', createdAt: 1000 }]),
      },
    });
    localStore.aiDialogues.set('solo-dlg', { ...cloudCopy, messages: cloudCopy.messages.slice(0, 2), updatedAt: 3000 });

    const res = await restoreAIDataFromCloud('user_1');

    const after = localStore.aiDialogues.get('solo-dlg') as { messages: Array<{ id: string }> };
    expect(after.messages.map(m => m.id), 'ходят с другого устройства не применились').toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(res.failed).toBe(0);
    expect(res.localStoreRecords).toBe(1);
  });

  it('T-6: ключи с @seg в хранилище, отличном от aiDialogues, не усекаются и доезжают оба', async () => {
    localStoreRecordsDocs.push({
      store: 'aiProfileFacets',
      key: 'facet@seg1-first',
      payload: { data: JSON.stringify({ id: 'facet@seg1-first', trait: 'curiosity', updatedAt: 2000 }) },
    });
    localStoreRecordsDocs.push({
      store: 'aiProfileFacets',
      key: 'facet@seg2-second',
      payload: { data: JSON.stringify({ id: 'facet@seg2-second', trait: 'empathy', updatedAt: 2000 }) },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.failed).toBe(0);
    expect(res.localStoreRecords).toBe(2);
    expect(localStore.aiProfileFacets.get('facet@seg1-first')).toMatchObject({ trait: 'curiosity' });
    expect(localStore.aiProfileFacets.get('facet@seg2-second')).toMatchObject({ trait: 'empathy' });
  });

  it('страницы 0.9.29 рядом с осиротевшими окнами читаются, а не пропускаются', async () => {
    const json = JSON.stringify({
      id: 'paged-dlg', title: 'Т', personaId: 'cbt', personaName: 'КПТ', personaEmoji: '🎯',
      messages: [
        { id: 'u1', role: 'user', content: 'Общий вопрос', createdAt: 1000 },
        { id: 'a1', role: 'assistant', content: 'Общий ответ', createdAt: 1001 },
      ],
      createdAt: 1000, updatedAt: 6000,
    });
    const half = Math.ceil(json.length / 2);
    // Старый клиент пишет страницы `id#0…N` и сносит строку `id`; осиротевшее окно
    // нового формата остаётся лежать рядом и раньше попадал в ту же группу.
    for (const i of [0, 1]) {
      localStoreRecordsDocs.push({
        store: 'aiDialogues', key: `paged-dlg#${i}`,
        payload: { data: json.slice(i * half, (i + 1) * half), updatedAt: 6000, page: i, totalPages: 2 },
      });
    }
    localStoreRecordsDocs.push({
      store: 'aiDialogues', key: 'paged-dlg@seg1000-bbbbbbbb',
      payload: { seg: true, headKey: 'paged-dlg', firstAt: 1000, lastAt: 1001, updatedAt: 7000, messages: '[]' },
    });

    const res = await restoreAIDataFromCloud('user_1');

    const after = localStore.aiDialogues.get('paged-dlg') as { messages: unknown[] } | undefined;
    expect(after, 'постраничная копия с осиротевшим окном не прочиталась').toBeDefined();
    expect(after!.messages).toHaveLength(2);
    expect(res.failed).toBe(0);
  });

  it('head с deletedAt собирается надгробием, а не живым диалогом', async () => {
    // Писатель эту сторону держал (head с deletedAt — dialogueSegmentUpload.m5), а
    // читатель — никто: снятый `deletedAt` в assembleDialogue возвращал удалённый
    // сегментный диалог новому устройству как обычный.
    const segKey = 'dead-win@seg1000-abcd';
    localStoreRecordsDocs.push({
      store: 'aiDialogues', key: 'dead-win',
      payload: {
        head: true, id: 'dead-win', title: 'Т', personaId: 'cbt', personaName: 'КПТ', personaEmoji: '🎯',
        createdAt: 1000, updatedAt: 8000, deletedAt: 7000, segments: [{ key: segKey, firstAt: 1000, lastAt: 1001, updatedAt: 1001, bytes: 10, count: 2 }],
      },
    });
    localStoreRecordsDocs.push({
      store: 'aiDialogues', key: segKey,
      payload: {
        seg: true, headKey: 'dead-win', firstAt: 1000, lastAt: 1001, updatedAt: 1001,
        messages: JSON.stringify([
          { id: 'u1', role: 'user', content: 'Общий вопрос', createdAt: 1000 },
          { id: 'a1', role: 'assistant', content: 'Общий ответ', createdAt: 1001 },
        ]),
      },
    });

    const res = await restoreAIDataFromCloud('user_1');

    const got = localStore.aiDialogues.get('dead-win') as { deletedAt?: number } | undefined;
    expect(got, 'окно с head не прочиталось').toBeDefined();
    expect(got!.deletedAt, 'удалённый сегментный диалог ожил на свежем устройстве').toBe(7000);
    expect(res.failed).toBe(0);
  });

  it('maxUpdatedAt остаётся 0, когда в облаке ничего нет (курсор нельзя задирать)', async () => {
    const res = await restoreAIDataFromCloud('user_1');
    expect(res.maxUpdatedAt).toBe(0);
  });

  it('rejects record exceeding MAX_RESTORE_RECORD_BYTES, reports oversized with both numbers and never malformed (AG-RESTORE-4)', async () => {
    // Payload slightly above MAX_RESTORE_RECORD_BYTES (10 MB)
    const padding = 'y'.repeat(MAX_RESTORE_RECORD_BYTES + 1024);
    const oversizedObj = { id: 'huge-dlg', pad: padding, updatedAt: 3000 };
    const jsonStr = JSON.stringify(oversizedObj);
    const recordBytes = new TextEncoder().encode(jsonStr).length;
    expect(recordBytes).toBeGreaterThan(MAX_RESTORE_RECORD_BYTES);

    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'huge-dlg',
      payload: { data: jsonStr, updatedAt: 3000 },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(0);
    expect(res.oversized).toBe(1);
    expect(res.failed).toBe(0);
    expect(localStore.aiDialogues.get('huge-dlg')).toBeUndefined();

    // Verify reportError was called with warning level, recordBytes, and limit
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(new RegExp(`oversized local_store_record \\(${recordBytes} bytes, limit ${MAX_RESTORE_RECORD_BYTES} bytes\\)`)),
      }),
      { store: 'aiDialogues', key: 'huge-dlg', bytes: recordBytes, limit: MAX_RESTORE_RECORD_BYTES },
      'warning'
    );

    // Verify reportError was NEVER called with 'malformed'
    const reportCalls = vi.mocked(reportError).mock.calls;
    for (const call of reportCalls) {
      const err = call[0] as Error;
      expect(err.message).not.toContain('malformed');
    }

    // Verify logger.warn was called with size and limit
    expect(logger.warn).toHaveBeenCalledWith(
      'AIRestoreService',
      expect.stringContaining(`Record too large to restore (${recordBytes} bytes, limit ${MAX_RESTORE_RECORD_BYTES} bytes): aiDialogues/huge-dlg`)
    );
  });

  it('reports genuinely unparseable corrupted JSON as malformed (AG-RESTORE-4)', async () => {
    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'corrupt-dlg',
      payload: { data: '{ "id": "corrupt-dlg", invalid-json-syntax-here', updatedAt: 3000 },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.oversized).toBe(0);
    expect(localStore.aiDialogues.get('corrupt-dlg')).toBeUndefined();

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'restoreAIData: malformed local_store_record' }),
      { store: 'aiDialogues', key: 'corrupt-dlg' }
    );
  });

  it('restores production-shaped dialogue record (~941 KB across 2 pages) and validates checksum (AG-RESTORE-4)', async () => {
    // Production shape: ~941 KB across 2 pages (~470 KB each), paged with #0, #1
    const halfChunkSize = 470 * 1024;
    const chunk0 = '{"id":"prod-dlg","messages":["' + 'A'.repeat(halfChunkSize);
    const chunk1 = 'B'.repeat(halfChunkSize) + '"],"updatedAt":3000}';
    const fullJson = chunk0 + chunk1;
    const expectedChecksum = `hash-of:${fullJson}`;

    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'prod-dlg#0',
      payload: { data: chunk0, totalPages: 2, updatedAt: 3000 },
      checksum: expectedChecksum,
    });
    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'prod-dlg#1',
      payload: { data: chunk1, totalPages: 2, updatedAt: 3000 },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(1);
    expect(res.oversized).toBe(0);
    expect(res.failed).toBe(0);
    expect(localStore.aiDialogues.get('prod-dlg')).toBeDefined();
    expect((localStore.aiDialogues.get('prod-dlg') as any).id).toBe('prod-dlg');
  });

  it('fails restore and logs warning when checksum does not match for paged record (AG-RESTORE-4)', async () => {
    const chunk0 = '{"id":"bad-checksum-dlg","data":"part1';
    const chunk1 = 'part2","updatedAt":3000}';

    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'bad-checksum-dlg#0',
      payload: { data: chunk0, totalPages: 2, updatedAt: 3000 },
      checksum: 'hash-of:wrong-checksum-data',
    });
    localStoreRecordsDocs.push({
      store: 'aiDialogues',
      key: 'bad-checksum-dlg#1',
      payload: { data: chunk1, totalPages: 2, updatedAt: 3000 },
    });

    const res = await restoreAIDataFromCloud('user_1');

    expect(res.localStoreRecords).toBe(0);
    expect(res.failed).toBe(1);
    expect(localStore.aiDialogues.get('bad-checksum-dlg')).toBeUndefined();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'restoreAIData: checksum mismatch' }),
      { store: 'aiDialogues', key: 'bad-checksum-dlg' }
    );
  });


  it('restores embeddings when requested during cloud restore', async () => {
    localStorage.clear();
    requestEmbeddingRestore('user_1');
    summaryDocs.push({ id: 'doc-1', data: () => ({ tone: 'calm' }) });
    embeddingDocs.push({ id: 'doc-1', data: () => ({ vectorsJson: '[[1,2,3]]', contentHash: 'h1' }) });

    const result = await restoreAIDataFromCloud('user_1');

    expect(result.summaries).toBe(1);
    expect(result.embeddings).toBe(1);
  });

  it('pulls summaries and embeddings that are missing locally', async () => {
    summaryDocs.push({ id: 'doc-1', data: () => ({ tone: 'calm' }) });
    embeddingDocs.push({ id: 'doc-1', data: () => ({}) });

    const res = await restoreAIDataFromCloud('user-a');

    expect(res).toMatchObject({ summaries: 1, embeddings: 1, failed: 0 });
    expect(localStore.aiSummaries.get('doc-1')).toBeDefined();
    expect(localStore.aiEmbeddings.get('doc-1')).toBeDefined();
  });

  // It came from the cloud, so it is already there. Leaving it unmarked makes
  // the sync loop treat every restored record as pending and upload them all.
  it('marks a restored embedding as already in the cloud', async () => {
    embeddingDocs.push({ id: 'doc-1', data: () => ({}) });

    await restoreAIDataFromCloud('user-a');

    expect(localStore.aiEmbeddings.get('doc-1')).toMatchObject({ cloudSyncedAt: expect.any(Number) });
  });

  // Repairs records restored before that flag was set — otherwise they keep
  // being re-uploaded on every pass.
  it('marks an existing local embedding whose content the cloud already holds', async () => {
    localStore.aiEmbeddings.set('local_new', { documentId: 'local_new', contentHash: 'h1', vectors: [[1]] });
    embeddingDocs.push({ id: 'old_dead_id', data: () => ({}) });
    decodeCloudEmbedding.mockResolvedValueOnce({ documentId: 'old_dead_id', contentHash: 'h1' } as never);

    const res = await restoreAIDataFromCloud('user-a');

    expect(res.markedSynced).toBe(1);
    expect(localStore.aiEmbeddings.get('local_new')).toMatchObject({ cloudSyncedAt: expect.any(Number) });
  });

  it('does not mark a local embedding the cloud does not have', async () => {
    localStore.aiEmbeddings.set('local_new', { documentId: 'local_new', contentHash: 'h-not-in-cloud', vectors: [[1]] });
    embeddingDocs.push({ id: 'other', data: () => ({}) });
    decodeCloudEmbedding.mockResolvedValueOnce({ documentId: 'other', contentHash: 'h1' } as never);

    const res = await restoreAIDataFromCloud('user-a');

    expect(res.markedSynced).toBe(0);
    expect(localStore.aiEmbeddings.get('local_new')).not.toHaveProperty('cloudSyncedAt');
  });

  // A restore must never overwrite analysis newer than the cloud copy — the
  // cloud lags local by design (writes are budgeted and paced).
  it('leaves records that already exist locally untouched', async () => {
    localStore.aiSummaries.set('doc-1', { documentId: 'doc-1', tone: 'LOCAL' });
    summaryDocs.push({ id: 'doc-1', data: () => ({ tone: 'CLOUD' }) });

    const res = await restoreAIDataFromCloud('user-a');

    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.get('doc-1')).toEqual({ documentId: 'doc-1', tone: 'LOCAL' });
  });

  // Every decrypt would throw with the vault locked. Restoring then would burn
  // reads and mark the job done, so the caller must be told to retry.
  it('does nothing and reports skippedLocked when the vault is locked', async () => {
    getSessionKey.mockReturnValue(null as unknown as CryptoKey);
    summaryDocs.push({ id: 'doc-1', data: () => ({}) });

    const res = await restoreAIDataFromCloud('user-a');

    expect(res.skippedLocked).toBe(true);
    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.size).toBe(0);
  });

  it('runs with encryption disabled even though there is no session key', async () => {
    getEncryptionEnabled.mockReturnValue(false);
    getSessionKey.mockReturnValue(null as unknown as CryptoKey);
    summaryDocs.push({ id: 'doc-1', data: () => ({ tone: 'calm' }) });

    const res = await restoreAIDataFromCloud('user-a');

    expect(res.skippedLocked).toBe(false);
    expect(res.summaries).toBe(1);
  });

  it('counts a record that fails to decode and keeps going', async () => {
    decodeCloudSummary.mockRejectedValueOnce(new Error('bad payload'));
    summaryDocs.push({ id: 'bad', data: () => ({}) }, { id: 'good', data: () => ({}) });

    const res = await restoreAIDataFromCloud('user-a');

    expect(res.failed).toBe(1);
    expect(res.summaries).toBe(1);
    expect(localStore.aiSummaries.get('good')).toBeDefined();
  });

  it('does nothing without a user id', async () => {
    summaryDocs.push({ id: 'doc-1', data: () => ({}) });
    const res = await restoreAIDataFromCloud('');
    expect(res).toMatchObject({ summaries: 0, embeddings: 0 });
  });

  it('LS-4: User A requests embedding restore, User B does not fetch embeddings', async () => {
    localStorage.clear();
    const { DataProvider } = await import('../../../../core/data');
    const paginatedSpy = vi.spyOn(DataProvider, 'getUserEmbeddingsPaginated');
    paginatedSpy.mockClear();

    // User A requests embedding restore
    requestEmbeddingRestore('user-A');

    // User B runs restoreAIDataFromCloud
    const resB = await restoreAIDataFromCloud('user-B');

    expect(paginatedSpy).not.toHaveBeenCalled();
    expect(resB.embeddings).toBe(0);

    // User A runs restoreAIDataFromCloud
    await restoreAIDataFromCloud('user-A');
    expect(paginatedSpy).toHaveBeenCalledWith('user-A', expect.any(Number), undefined);
  });
});

describe('reattachOrphanedAnalysis', () => {
  beforeEach(() => {
    localStore.aiSummaries = new Map();
    localStore.aiEmbeddings = new Map();
    localStore.aiTimeline = new Map();
    localStore.documents = new Map();
    latestContent.clear();
  });

  const addNote = (id: string, text: string, lastSessionAt?: number, uuid?: string) => {
    localStore.documents.set(id, { id, uuid, lastSessionAt: lastSessionAt ?? Date.parse('2026-07-01') });
    latestContent.set(id, text);
  };

  /**
   * The whole point: analysis is keyed by a per-device local id, so a note
   * downloaded again after a wipe gets a new id and its analysis is stranded.
   */
  it('adopts a stranded summary onto the note with the same text', async () => {
    addNote('local_new', 'the note text');
    localStore.aiSummaries.set('local_dead', {
      documentId: 'local_dead',
      contentHash: 'hash-of:the note text',
      tone: 'calm',
      themes: ['work'],
      extractedFacts: ['a fact'],
      insights: [],
    });

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(1);
    expect(localStore.aiSummaries.get('local_new')).toMatchObject({ documentId: 'local_new', tone: 'calm' });
    expect(localStore.aiSummaries.has('local_dead')).toBe(false);
  });

  it('rebuilds the timeline row so the life story comes back', async () => {
    addNote('local_new', 'the note text', Date.parse('2026-03-14'));
    localStore.aiSummaries.set('local_dead', {
      documentId: 'local_dead',
      contentHash: 'hash-of:the note text',
      tone: 'calm', themes: [], extractedFacts: ['a fact'], insights: [],
    });

    await reattachOrphanedAnalysis();

    expect(localStore.aiTimeline.get('local_new')).toMatchObject({
      documentId: 'local_new',
      date: '2026-03-14',
      month: '2026-03',
      facts: ['a fact'],
    });
  });

  it('adopts a stranded embedding too', async () => {
    addNote('local_new', 'the note text');
    localStore.aiEmbeddings.set('local_dead', {
      documentId: 'local_dead',
      contentHash: 'hash-of:the note text',
      vectors: [[1, 2]],
    });

    const res = await reattachOrphanedAnalysis();

    expect(res.embeddings).toBe(1);
    expect(localStore.aiEmbeddings.get('local_new')).toMatchObject({ vectors: [[1, 2]] });
  });

  // Adopting on anything looser than an exact hash would attach one note's
  // analysis to a different note — worse than having none.
  it('does not adopt when the text differs', async () => {
    addNote('local_new', 'different text');
    localStore.aiSummaries.set('local_dead', {
      documentId: 'local_dead',
      contentHash: 'hash-of:the note text',
      tone: 'calm', themes: [], extractedFacts: [], insights: [],
    });

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.has('local_dead')).toBe(true);
  });

  it('gives one stranded summary to only one of two identical notes', async () => {
    addNote('local_a', 'same text');
    addNote('local_b', 'same text');
    localStore.aiSummaries.set('local_dead', {
      documentId: 'local_dead',
      contentHash: 'hash-of:same text',
      tone: 'calm', themes: [], extractedFacts: [], insights: [],
    });

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(1);
    const adopted = ['local_a', 'local_b'].filter(id => localStore.aiSummaries.has(id));
    expect(adopted).toHaveLength(1);
  });

  it('leaves a note that already has its own analysis alone', async () => {
    addNote('local_new', 'the note text');
    localStore.aiSummaries.set('local_new', { documentId: 'local_new', tone: 'MINE', contentHash: 'hash-of:the note text' });
    localStore.aiSummaries.set('local_dead', {
      documentId: 'local_dead',
      contentHash: 'hash-of:the note text',
      tone: 'STRANDED', themes: [], extractedFacts: [], insights: [],
    });

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.get('local_new')).toMatchObject({ tone: 'MINE' });
  });

  it('returns early and hashes nothing when there are no orphans', async () => {
    addNote('local_new', 'the note text');
    const res = await reattachOrphanedAnalysis();
    expect(res).toEqual({ summaries: 0, embeddings: 0 });
  });

  it('ignores stranded analysis that has no content hash to match on', async () => {
    addNote('local_new', 'the note text');
    localStore.aiSummaries.set('local_dead', { documentId: 'local_dead', tone: 'calm' });

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(0);
  });

  // ── G4: uuid-first matching ─────────────────────────────────────────

  it('matches two notes with identical text by uuid, not by hash', async () => {
    addNote('local_a', 'same text', undefined, 'uuid-a');
    addNote('local_b', 'same text', undefined, 'uuid-b');
    localStore.aiSummaries.set('orphan_a', {
      documentId: 'orphan_a',
      documentUuid: 'uuid-a',
      contentHash: 'hash-of:same text',
      tone: 'calm', themes: [], extractedFacts: [], insights: [],
    });
    localStore.aiSummaries.set('orphan_b', {
      documentId: 'orphan_b',
      documentUuid: 'uuid-b',
      contentHash: 'hash-of:same text',
      tone: 'excited', themes: [], extractedFacts: [], insights: [],
    });

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(2);
    expect(localStore.aiSummaries.get('local_a')).toMatchObject({ tone: 'calm' });
    expect(localStore.aiSummaries.get('local_b')).toMatchObject({ tone: 'excited' });
    expect(localStore.aiSummaries.has('orphan_a')).toBe(false);
    expect(localStore.aiSummaries.has('orphan_b')).toBe(false);
  });

  it('falls back to contentHash when documentUuid is absent', async () => {
    addNote('local_new', 'the note text', undefined, 'uuid-new');
    localStore.aiSummaries.set('local_dead', {
      documentId: 'local_dead',
      // no documentUuid — legacy record
      contentHash: 'hash-of:the note text',
      tone: 'calm', themes: [], extractedFacts: [], insights: [],
    });

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(1);
    expect(localStore.aiSummaries.get('local_new')).toMatchObject({ documentId: 'local_new', tone: 'calm' });
  });

  it('does not fall back to hash when documentUuid is set but has no match', async () => {
    addNote('local_new', 'the note text', undefined, 'uuid-new');
    localStore.aiSummaries.set('local_dead', {
      documentId: 'local_dead',
      documentUuid: 'uuid-nonexistent',
      contentHash: 'hash-of:the note text',
      tone: 'calm', themes: [], extractedFacts: [], insights: [],
    });

    const res = await reattachOrphanedAnalysis();

    // documentUuid is set but doesn't match any doc → not adopted via hash either
    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.has('local_dead')).toBe(true);
  });

  // N-39: провайдер отбрасывает чужие строки, и в странице своих меньше десяти.
  // Конец списка — по числу строк, которые отдал сервер, иначе восстановление
  // эмбеддингов объявлялось законченным на первой же такой странице.
  it('a page thinned by the owner filter does not end the embedding restore', async () => {
    localStorage.clear();
    const { DataProvider } = await import('../../../../core/data');
    const spy = vi.spyOn(DataProvider, 'getUserEmbeddingsPaginated')
      .mockResolvedValueOnce({ items: Array.from({ length: 9 }, (_, i) => ({ id: `e${i}` })), nextCursorId: 'e9', readCount: 10 })
      .mockResolvedValueOnce({ items: [], readCount: 0 });
    requestEmbeddingRestore('user-n39');
    await restoreAIDataFromCloud('user-n39');
    // Вторая страница запрошена — значит, первая, прореженная фильтром, конец не объявила.
    expect(spy.mock.calls.some(([, , cursor]) => cursor === 'e9')).toBe(true);
    spy.mockRestore();
  });
});

// ── L-5 (R4-076): привязка сироты не возвращает удалённое и не трогает
// исключённое из AI ──────────────────────────────────────────────────────

const PENDING_ANALYSIS_DELETES_KEY = 'ai_sync_pending_analysis_deletes';

describe('reattachOrphanedAnalysis — L-5 guards', () => {
  beforeEach(() => {
    localStorage.clear();
    localStore.aiSummaries = new Map();
    localStore.aiEmbeddings = new Map();
    localStore.aiTimeline = new Map();
    localStore.documents = new Map();
    latestContent.clear();
  });

  const addGuardedNote = (id: string, text: string, uuid: string, extra?: Record<string, unknown>) => {
    localStore.documents.set(id, { id, uuid, lastSessionAt: Date.parse('2026-07-01'), ...extra });
    latestContent.set(id, text);
  };

  const seedOrphan = (key: string, uuid: string) => {
    localStore.aiSummaries.set(key, {
      documentId: key,
      ...(uuid ? { documentUuid: uuid } : {}),
      contentHash: 'hash-of:the note text',
      tone: 'calm', themes: [], extractedFacts: [], insights: [],
    });
  };

  it('a summary whose uuid is in pending analysis deletes is not attached', async () => {
    localStorage.setItem(PENDING_ANALYSIS_DELETES_KEY, JSON.stringify([
      { uid: 'u_reattach', canonicalId: 'note-uuid-1' },
    ]));
    addGuardedNote('local_new', 'the note text', 'note-uuid-1');
    seedOrphan('local_dead', 'note-uuid-1');

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.has('local_dead')).toBe(true);
    expect(localStore.aiSummaries.has('local_new')).toBe(false);
  });

  it('a summary is not attached to a note excluded from AI', async () => {
    addGuardedNote('local_new', 'the note text', 'note-uuid-2', { excludedFromAI: true });
    seedOrphan('local_dead', 'note-uuid-2');

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.has('local_dead')).toBe(true);
    expect(localStore.aiSummaries.has('local_new')).toBe(false);
  });

  it('an unreadable delete-journal skips the whole pass (fail-closed)', async () => {
    localStorage.setItem(PENDING_ANALYSIS_DELETES_KEY, '{corrupt');
    addGuardedNote('local_new', 'the note text', 'note-uuid-3');
    seedOrphan('local_dead', 'note-uuid-3');

    const res = await reattachOrphanedAnalysis();

    expect(res.summaries).toBe(0);
    expect(localStore.aiSummaries.has('local_dead')).toBe(true);
    expect(localStore.aiSummaries.has('local_new')).toBe(false);
  });
});
