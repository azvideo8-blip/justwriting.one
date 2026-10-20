import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  LocalStoreSyncManager,
  getLocalStoreSyncSummary,
  readPersistedDeletes,
  getPendingStoreUpserts,
  readScopedJournal,
  _resetReportedForTests,
} from '../LocalStoreSyncService';
import { journalKeyFor } from '../../sync/syncJournal';
import { DataProvider } from '../../data';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';

// S0-2 (F-3, R7F-020): журналы ИИ-синка лежали на ОДНОМ ключе браузера, uid был
// только внутри строк. Одна структурно битая строка чужой учётки = `null` всего
// журнала = стоп выгрузки и забора у ВСЕХ аккаунтов устройства. Плюс
// `readPersistedUpserts` читал нечитаемый журнал как пустой (остаток R3-012):
// «не знаю, что надо отправить» притворялось «отправлять нечего».
//
// Правка: журнал — на учётку (тот же образец, что `oversizedKeyFor`, R4-017);
// при первом чтении своего ключа строки разбираются по uid из общего ключа, а
// сам общий ключ остаётся на месте один релиз — на откат. Битая строка внутри
// СВОЕГО журнала исцеляется спасением валидных (как уже делала), а не обнуляет
// чужие обязательство; нечитаемый журнал правок — fail-closed.
//
// Перенос очереди в IndexedDB (то же задание тикета) здесь НЕ сделан: см.
// отчёт SYNC0, S0-2 — причина и объём.

const UID = 'u_s02_own';
const OTHER = 'u_s02_other';
const DELETES = 'ai_sync_pending_deletes';
const UPSERTS = 'ai_sync_pending_upserts';

let saved: string[];

vi.mock('../../data', () => ({
  DataProvider: {
    getLocalStoreRecords: async () => [],
    getLocalStoreRecord: async () => null,
    getLocalStoreStamps: async () => [],
    saveLocalStoreRecord: async () => {},
    saveLocalStoreRecordIfUnstamped: async () => ({ written: true, stampedAt: null }),
    saveLocalStoreRecordPages: async () => {},
    deleteLocalStoreRecord: async () => {},
    deleteLocalStorePagedRecords: async () => {},
    deleteLocalStoreExactRecord: async () => {},
    getLocalStoreRecordsByKeyPrefix: async () => [],
    getUserSummaries: async () => [],
  },
}));
vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: UID, email: 'u@example.com' }),
  getCurrentUserId: () => UID,
}));
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
}));
vi.mock('../../crypto/encrypt', () => ({ getSessionKey: () => ({}) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../shared/errors/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

const { reportError } = await import('../../../shared/errors/reportError');


async function waitUntil(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise(res => setTimeout(res, 5));
  }
  throw new Error(`не дождались: ${what}`);
}

describe('S0-2: журналы синка — по учёткам', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    saved = [];
    // Мок-объект провайдера — обычный литерал функций; шпимон нужен живой.
    (DataProvider as unknown as Record<string, unknown>).saveLocalStoreRecordIfUnstamped = vi.fn(
      async (_u: string, store: string, key: string) => {
        saved.push(`${store}:${key}`);
        return { written: true, stampedAt: null };
      },
    );
    localStorage.clear();
    resetDbInstance();
    _resetReportedForTests();
    const db = await getLocalDb(UID);
    await db.put('aiPortrait', { id: 'p1', summary: 'правка', updatedAt: 1000 } as never);
  });

  afterEach(() => { resetDbInstance(); });

  it('битая строка чужой учётки в общем журнале не останавливает свой upsert', async () => {
    // Ровно посадка RT-3: строка без key от другой учётки (и другой версии приложения).
    localStorage.setItem(DELETES, JSON.stringify([
      { uid: UID, store: 'aiBeliefs', key: 'b1' },
      { uid: OTHER, store: 'aiThreads' },
    ]));

    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreSync('aiPortrait', 'p1');
    const res = await tab.flushPending(true);

    // Два успеха: свой upsert и перенесённое из общего ключа обязательство удаления.
    expect(res.synced, 'свой upsert обязан уйти').toBe(2);
    expect(saved).toContain('aiPortrait:p1');
    expect(getLocalStoreSyncSummary(UID).unknown, 'журнал читается — «не знаю» снимается').toBe(false);
  });

  it('перенос из общего ключа — только свои строки, общий ключ остаётся', async () => {
    localStorage.setItem(DELETES, JSON.stringify([
      { uid: UID, store: 'aiBeliefs', key: 'своя' },
      { uid: OTHER, store: 'aiBeliefs', key: 'чужая' },
    ]));

    expect(readPersistedDeletes()).toEqual([{ uid: UID, store: 'aiBeliefs', key: 'своя' }]);
    expect(localStorage.getItem(journalKeyFor(DELETES, UID)), 'свой ключ заведён').not.toBeNull();
    expect(localStorage.getItem(DELETES), 'общий ключ не удалён — один релиз на откат').not.toBeNull();
    // Тот же общий ключ для другой учётки отдаёт её строки, а не наши.
    expect(readScopedJournal(DELETES, OTHER)).toEqual([{ uid: OTHER, store: 'aiBeliefs', key: 'чужая' }]);
  });

  it('нечитаемый журнал невыгруженных правок — «не знаю», а не «пусто»', async () => {
    localStorage.setItem(journalKeyFor(UPSERTS, UID), '{битый');
    expect(getPendingStoreUpserts(UID), 'нечитаемый журнал — null').toBeNull();
    expect(getLocalStoreSyncSummary(UID).unknown).toBe(true);

    const tab = new LocalStoreSyncManager();
    const res = await tab.flushPending(true);
    expect(res.synced, 'на неизвестном журнале правок не уходит').toBe(0);
    expect(saved).toEqual([]);
  });

  it('своя битая строка исцеляется спасением: журнал читается со второго прохода', async () => {
    localStorage.setItem(journalKeyFor(DELETES, UID), JSON.stringify([
      { uid: UID, store: 'aiBeliefs', key: 'b1' },
      { uid: UID, store: 'aiThreads' },
    ]));

    // Строка без key могла быть живым обязательством — первый проход не угадывает.
    expect(readPersistedDeletes()).toBeNull();
    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreSync('aiPortrait', 'p1');
    // Нечитаемый журнал удалений гонит scheduleStoreSync веткой с await (A-3.2):
    // маркер правки появляется на тик позже. Ждём ПО УСЛОВИЮ, а не одним
    // `setTimeout(0)`: под нагрузкой полного прогона одного тика не хватает,
    // дренаж стартует без обязательства, и тест красный без причины в коде.
    await waitUntil(
      () => (localStorage.getItem(journalKeyFor('ai_sync_pending_upserts', UID)) ?? '').includes('aiPortrait'),
      'маркер правки в журнале своей учётки',
    );

    const first = await tab.flushPending(true);
    expect(first.synced, 'на неизвестном журнале правка не уходит').toBe(0);
    expect(saved).toEqual([]);
    expect(readPersistedDeletes(), 'починка спасла валидную строку своей учётки')
      .toEqual([{ uid: UID, store: 'aiBeliefs', key: 'b1' }]);

    const second = await tab.flushPending(true);
    expect(saved, 'после починки своя правка уходит').toContain('aiPortrait:p1');
    expect(second.synced).toBe(2);   // спасённое удаление + правка
  });

  it('контроль: пустой свой журнал не блокирует выгрузку', async () => {
    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreSync('aiPortrait', 'p1');
    const res = await tab.flushPending(true);
    expect(res.synced).toBe(1);
    expect(saved).toContain('aiPortrait:p1');
  });

  it('журнал owed-секунд больше не на общем ключе', async () => {
    const { oweSessionDuration, owedSessionDuration } = await import('../pendingDuration');
    localStorage.setItem('sync_pending_duration', JSON.stringify([
      { uid: OTHER, docId: 'd-foreign' },          // чужая строка: не должна влиять на нас
    ]));
    oweSessionDuration(UID, 'd-own', 30);
    expect(owedSessionDuration(UID, 'd-own')).toBe(30);
    expect(owedSessionDuration(OTHER, 'd-foreign'), 'чужой долг виден только его владельцу').toBe(0);
    expect(localStorage.getItem(journalKeyFor('sync_pending_duration', UID))).toContain('d-own');
    expect(reportError).not.toHaveBeenCalled();
  });
});
