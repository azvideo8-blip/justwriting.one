import { describe, it, expect, vi, beforeEach } from 'vitest';

// NB-10 (sus25): журнал удалений разборов не читается — восстановление молча
// пропускает разделы (fail-closed), а окно показывает «завершено». Отказ должен
// быть назван: sectionFailed в итоге восстановления и failed в итоге reattach.
// Край — localStorage (битый JSON журнала); сервисы настоящие.
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
    objectStoreNames: { contains: (s: string) => s in localStore },
    getAllKeys: async (store: StoreName) => [...(localStore[store]?.keys() ?? [])],
    getAll: async (store: StoreName) => [...(localStore[store]?.values() ?? [])],
    get: async (store: StoreName, key: string) => localStore[store]?.get(key),
    put: async (store: StoreName, value: { documentId?: string; id?: string; eventDate?: string }) => {
      const key = (value.documentId ?? value.id ?? value.eventDate)!;
      if (localStore[store] === undefined) localStore[store] = new Map();
      localStore[store].set(key, value);
    },
    delete: async (store: StoreName, key: string) => { localStore[store]?.delete(key); },
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
  LocalVersionService: { getLatestContent: async (id: string) => latestContent.get(id) ?? '' },
}));

vi.mock('../../utils/embeddingIndexer', () => ({
  sha256Hex: async (text: string) => `hash-of:${text}`,
}));

const summaryDocs: Array<{ id: string; data: () => unknown }> = [];
const localStoreRecordsDocs: Array<{ store: string; key: string; payload: Record<string, unknown> }> = [];

vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getUserSummaries: async () => summaryDocs.map(d => ({ id: d.id, ...(d.data() as object) })),
    getUserEmbeddingsPaginated: async () => ({ items: [], nextCursorId: null, readCount: 0 }),
    getUserEmbeddingsSince: async () => [],
    getLocalStoreRecords: async () => localStoreRecordsDocs,
  },
}));

const getSessionKey = vi.fn(() => ({} as CryptoKey));
vi.mock('../../../../core/crypto/encrypt', () => ({ getSessionKey: () => getSessionKey() }));

const getEncryptionEnabled = vi.fn((_uid: string) => true);
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: (uid: string) => getEncryptionEnabled(uid),
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
}));

vi.mock('../../../../shared/errors/reportError', async (orig) => ({
  ...(await orig<typeof import('../../../../shared/errors/reportError')>()),
  reportError: vi.fn(),
}));
vi.mock('../../../../shared/errors/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_reattach' }) }));

vi.mock('../AISummaryService', () => ({
  decodeCloudSummary: async (d: Record<string, unknown>, id: string) => ({ documentId: id, tone: d.tone }),
}));
vi.mock('../AIEmbeddingService', () => ({
  decodeCloudEmbedding: async (_d: Record<string, unknown>, id: string) => ({ documentId: id, vectors: [[1]] }),
}));

import { restoreAIDataFromCloud, reattachOrphanedAnalysis, restoreAndReattachAIData } from '../AIRestoreService';

const JOURNAL = 'ai_sync_pending_analysis_deletes';

describe('sus25: нечитаемый журнал удалений назван, а не «завершено»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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
    localStoreRecordsDocs.length = 0;
    getSessionKey.mockReturnValue({} as CryptoKey);
    getEncryptionEnabled.mockReturnValue(true);
  });

  // Ревью 0.11.24: отказ назван отдельным полем, а не sectionFailed — иначе
  // фоновый курсор стоял бы навсегда (журнал сам не чинится), а тяжёлый проход
  // шёл бы каждые 30 минут. Мутация: снова sectionFailed — красный.
  it('restoreAIDataFromCloud: журнал не читается → назван, разборы не возвращаются, курсор не стоит', async () => {
    localStorage.setItem(`${JOURNAL}:user_1`, '{битый json');
    summaryDocs.push({ id: 'cloud_s1', data: () => ({ tone: 'нейтральный', documentUuid: 'u1' }) });

    const r = await restoreAIDataFromCloud('user_1');

    expect(r.analysisJournalUnreadable).toBe(true);
    expect(r.sectionFailed).toBeFalsy();
    expect(r.summaries).toBe(0);
    expect(localStore.aiSummaries.size).toBe(0);
  });

  it('контроль: журнал читается (пуст) → sectionFailed нет, разбор вернулся', async () => {
    summaryDocs.push({ id: 'cloud_s1', data: () => ({ tone: 'нейтральный', documentUuid: 'u1' }) });

    const r = await restoreAIDataFromCloud('user_1');

    expect(r.sectionFailed).toBeFalsy();
    expect(r.summaries).toBe(1);
  });

  it('reattachOrphanedAnalysis: журнал не читается → failed, сирота не привязана', async () => {
    localStorage.setItem(`${JOURNAL}:u_reattach`, 'не json');
    localStore.documents.set('local_new', { id: 'local_new', uuid: 'u1' });
    localStore.aiSummaries.set('old_id', { documentId: 'old_id', documentUuid: 'u1', tone: 'x' });

    const out = await reattachOrphanedAnalysis();

    expect(out.failed).toBe(true);
    expect(out.summaries).toBe(0);
    expect(localStore.aiSummaries.has('old_id')).toBe(true);
  });

  it('контроль reattach: журнал пуст → сирота привязана, отказа нет', async () => {
    localStore.documents.set('local_new', { id: 'local_new', uuid: 'u1' });
    localStore.aiSummaries.set('old_id', { documentId: 'old_id', documentUuid: 'u1', tone: 'x' });

    const out = await reattachOrphanedAnalysis();

    expect(out.failed).toBeFalsy();
    expect(out.summaries).toBe(1);
    expect(localStore.aiSummaries.has('local_new')).toBe(true);
  });

  it('restoreAndReattachAIData: отказ reattach слит в общий итог → sectionFailed', async () => {
    // Журнал восстановления (user_1) читается, журнал reattach (u_reattach) — нет.
    localStorage.setItem(`${JOURNAL}:u_reattach`, '{битый json');

    const r = await restoreAndReattachAIData('user_1');

    expect(r.sectionFailed).toBe(true);
  });

  it('контроль: оба журнала читаются → sectionFailed нет', async () => {
    const r = await restoreAndReattachAIData('user_1');

    expect(r.sectionFailed).toBeFalsy();
  });
});