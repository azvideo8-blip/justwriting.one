import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { emitDomainEvent, _resetDomainEventHandlersForTests } from '../../../../core/events/domainEvents';
import { initAiDomainEvents } from '../../subscribeDomainEvents';
import { reportError } from '../../../../shared/errors/reportError';
import { journalKeyFor } from '../../../../core/sync/syncJournal';
import { writeFacetStore } from '../../../../core/services/facetLock';
import {
  LOCAL_PURGE_SLOW_RETRY_MS,
  MAX_LOCAL_PURGE_ATTEMPTS,
  persistPendingLocalPurge,
  readPendingLocalPurges,
  retryPendingLocalPurges,
} from '../pendingLocalPurges';

// EX-1: отказ локальной уборки производных (дайджест месяца) не должен быть
// молчаливым и не должен теряться: запись в журнал повтора, повтор по такту.
// Реальная уборка (purgeNoteDerivatives) и реальный IndexedDB; подменяется только
// операция удаления стора `aiMonthlyDigest` — она и даёт отказ.

const USER = 'user_ex1_purge';
const DOC_ID = 'local_doc_ex1_1';
const JOURNAL_KEY = journalKeyFor('ai_sync_pending_local_purges', USER);

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: USER }) }));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    deleteSummary: vi.fn().mockResolvedValue(undefined),
    deleteEmbedding: vi.fn().mockResolvedValue(undefined),
    getUserSummaries: vi.fn().mockResolvedValue([]),
    getLocalStoreRecords: vi.fn().mockResolvedValue([]),
    getPublicDocSummaries: vi.fn().mockResolvedValue([]),
  },
}));

let digestRefusal: { active: boolean } = { active: false };
const portraitRefusal = { active: false };
const facetRefusal = { active: false };
const facetReadRefusal = { active: false };
let origGetAll: IDBObjectStore['getAll'];
let origPut: IDBObjectStore['put'];
let origDelete: IDBObjectStore['delete'];

function refuseDigestDeletes(on: boolean): void {
  digestRefusal.active = on;
}

async function seedNote(excluded: boolean): Promise<void> {
  const db = await getLocalDb(USER);
  await db.put('documents', {
    id: DOC_ID,
    uuid: 'canon-ex1-uuid',
    guestId: USER,
    title: 'EX-1 synthetic note',
    currentVersion: 1,
    totalWords: 10,
    totalDuration: 10,
    sessionsCount: 1,
    firstSessionAt: 1000,
    lastSessionAt: 1000,
    tags: [],
    aiProcessed: true,
    excludedFromAI: excluded,
  } as any);
  await db.put('aiMonthlyDigest', { month: '2026-10', noteIds: [DOC_ID], text: 'digest' } as any);
}

async function digestRow(): Promise<unknown> {
  const db = await getLocalDb(USER);
  return db.get('aiMonthlyDigest', '2026-10');
}

describe('EX-1: повтор локальной уборки производных', () => {
  let off: () => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    _resetDomainEventHandlersForTests();
    const db = await getLocalDb(USER);
    await db.clear('documents');
    await db.clear('aiMonthlyDigest');
    await db.clear('aiSummaries');
    await db.clear('aiTimeline');
    await db.clear('aiPortrait');
    await writeFacetStore(store => store.clear());
    // Отказ удаления дайджеста — настоящая ошибка стора IndexedDB, не мок уборки.
    origDelete = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (digestRefusal.active && this.name === 'aiMonthlyDigest') {
        throw new DOMException('digest store refused (EX-1 synthetic)', 'UnknownError');
      }
      if (portraitRefusal.active && this.name === 'aiPortrait') {
        throw new DOMException('digest store refused (EX-1 synthetic)', 'UnknownError');
      }
      return origDelete.apply(this, args as [IDBValidKey | IDBKeyRange]);
    });
    origPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (facetRefusal.active && this.name === 'aiProfileFacets') {
        throw new DOMException('facet store refused (EX-1 synthetic)', 'UnknownError');
      }
      return origPut.apply(this, args as [unknown, IDBValidKey?]);
    });
    origGetAll = IDBObjectStore.prototype.getAll;
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (facetReadRefusal.active && this.name === 'aiProfileFacets') {
        throw new DOMException('facet read refused (EX-1 synthetic)', 'UnknownError');
      }
      return origGetAll.apply(this, args as [IDBValidKey | IDBKeyRange | null | undefined, number | undefined]);
    });
    off = initAiDomainEvents();
  });

  afterEach(() => {
    off();
    vi.restoreAllMocks();
    refuseDigestDeletes(false);
    portraitRefusal.active = false;
    facetRefusal.active = false;
    facetReadRefusal.active = false;
  });

  it('(а) скрытие: отказ уборки дайджеста — запись в журнале и предупреждение', async () => {
    await seedNote(true);
    refuseDigestDeletes(true);

    emitDomainEvent({ type: 'note.excludedFromAI', documentId: DOC_ID, excluded: true });

    await vi.waitFor(() => {
      expect(readPendingLocalPurges(USER)).toEqual([{ uid: USER, documentId: DOC_ID, digest: true, facets: false, portrait: false, assume: true, attempts: 0 }]);
    });
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'note_derivatives_purge_failed', documentId: DOC_ID }),
      'warning',
    );
  });

  it('(б) повтор: заметка скрыта, уборка проходит → дайджест убран, запись забыта', async () => {
    await seedNote(true);
    refuseDigestDeletes(true);
    emitDomainEvent({ type: 'note.excludedFromAI', documentId: DOC_ID, excluded: true });
    await vi.waitFor(() => expect(readPendingLocalPurges(USER)).toHaveLength(1));

    // Повтор, который снова упёрся в отказ, запись не забывает.
    const stillFailing = await retryPendingLocalPurges(USER);
    expect(stillFailing.failed).toBe(1);
    expect(readPendingLocalPurges(USER)).toHaveLength(1);

    refuseDigestDeletes(false);
    const res = await retryPendingLocalPurges(USER);

    expect(res.purged).toBe(1);
    expect(await digestRow()).toBeUndefined();
    expect(readPendingLocalPurges(USER)).toEqual([]);
  });

  it('(в) повтор: заметку вернули в ИИ → уборки нет, запись забыта', async () => {
    await seedNote(false);
    persistPendingLocalPurge(USER, DOC_ID);

    const res = await retryPendingLocalPurges(USER);

    expect(res.forgotten).toBe(1);
    expect(res.purged).toBe(0);
    expect(await digestRow()).toBeDefined();
    expect(readPendingLocalPurges(USER)).toEqual([]);
  });

  it('(г) нечитаемый журнал не переписывается одной новой записью', async () => {
    localStorage.setItem(JOURNAL_KEY, '{не json');

    persistPendingLocalPurge(USER, DOC_ID);

    expect(localStorage.getItem(JOURNAL_KEY)).toBe('{не json');
    expect(readPendingLocalPurges(USER)).toBeNull();
  });

  it('контроль: уборка прошла с первого раза → журнал пуст, предупреждения нет', async () => {
    await seedNote(true);

    emitDomainEvent({ type: 'note.excludedFromAI', documentId: DOC_ID, excluded: true });

    await vi.waitFor(async () => expect(await digestRow()).toBeUndefined());
    expect(readPendingLocalPurges(USER)).toEqual([]);
    expect(reportError).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'note_derivatives_purge_failed' }),
      'warning',
    );
  });

  // Ревью 0.11.24: первая попытка упала на портрете, а clearAnalysis тут же снёс
  // разбор, хронологию и aiProcessed — на повторе у заметки «нет производных»,
  // портрет не трогался, запись забывалась. Повтор считает, что производные были
  // («нет ответа ≠ не было»). Мутация: повтор без assumeDerivatives — портрет на
  // месте, красный.
  it('(д) отказ на портрете: повтор убирает портрет, хотя разбора уже нет', async () => {
    await seedNote(true);
    const db = await getLocalDb(USER);
    await db.put('aiPortrait', { id: 'singleton', text: 'synthetic portrait' } as any);
    portraitRefusal.active = true;
    emitDomainEvent({ type: 'note.excludedFromAI', documentId: DOC_ID, excluded: true });
    await vi.waitFor(() => expect(readPendingLocalPurges(USER)).toHaveLength(1));
    expect(await db.get('aiPortrait', 'singleton')).toBeDefined();
    expect((await db.get('documents', DOC_ID))?.aiProcessed).toBeFalsy();

    portraitRefusal.active = false;
    const res = await retryPendingLocalPurges(USER);

    expect(res.purged).toBe(1);
    expect(await db.get('aiPortrait', 'singleton')).toBeUndefined();
    expect(readPendingLocalPurges(USER)).toEqual([]);
  });

  // Ревью выпуска 0.11.24: повтор переделывает только упавшие части. Грани падают
  // снова — портрет, пересобранный человеком после первой попытки, не стирается
  // на каждом проходе. Мутация: повтор без only (все части) — портрет стёрт, красный.
  it('(е) грани падают на повторе — пересобранный портрет не трогается', async () => {
    await seedNote(true);
    const db = await getLocalDb(USER);
    await writeFacetStore(store => store.put({ id: 'f1', label: 'Тема', summary: 's', centroid: [], noteIds: [DOC_ID, 'other'], noteCount: 2, firstAt: 1, lastAt: 1, updatedAt: 1, buildId: 'b' } as any));
    await db.put('aiPortrait', { id: 'singleton', text: 'old portrait' } as any);
    facetRefusal.active = true;
    emitDomainEvent({ type: 'note.excludedFromAI', documentId: DOC_ID, excluded: true });
    await vi.waitFor(() => expect(readPendingLocalPurges(USER)).toHaveLength(1));
    expect(await db.get('aiPortrait', 'singleton')).toBeUndefined();
    expect(readPendingLocalPurges(USER)![0]).toMatchObject({ facets: true, portrait: false, digest: false });

    await db.put('aiPortrait', { id: 'singleton', text: 'rebuilt by the person' } as any);
    const res = await retryPendingLocalPurges(USER);

    expect(res.failed).toBe(1);
    expect(await db.get('aiPortrait', 'singleton')).toBeDefined();
    expect(readPendingLocalPurges(USER)![0]?.attempts).toBe(1);
  });

  // Заметку вернули в ИИ — запись снимается событием, повтор её не чистит.
  // Мутация: убрать forget в ветке excluded:false — запись остаётся, красный.
  it('(ж) заметку вернули в ИИ — запись снята сразу', async () => {
    persistPendingLocalPurge(USER, 'cloud_only_ex1');
    emitDomainEvent({ type: 'note.excludedFromAI', documentId: 'cloud_only_ex1', excluded: false });
    await vi.waitFor(() => expect(readPendingLocalPurges(USER)).toEqual([]));
  });

  // Запись с облачным номером: локальная заметка связана с ним и видна ИИ —
  // забыть без уборки. Мутация: искать только по локальному номеру — уборка
  // (дайджест удалён), красный.
  it('(з) запись по облачному номеру: связанная заметка видна ИИ — забыта без уборки', async () => {
    await seedNote(false);
    const db = await getLocalDb(USER);
    const doc = await db.get('documents', DOC_ID);
    await db.put('documents', { ...doc!, linkedCloudId: 'cloud_ex1' } as any);
    await db.put('aiMonthlyDigest', { month: '2026-10', noteIds: ['cloud_ex1'], text: 'digest' } as any);
    persistPendingLocalPurge(USER, 'cloud_ex1');

    const res = await retryPendingLocalPurges(USER);

    expect(res.forgotten).toBe(1);
    expect(await digestRow()).toBeDefined();
  });

  // Повтор не вечный, но и не бросает: после потолка — раз в сутки, запись
  // остаётся (снять её = оставить пересказ навсегда). Мутация: снимать запись
  // на потолке — красный.
  it('(и) после потолка попыток — повтор раз в сутки, запись остаётся', async () => {
    await seedNote(true);
    refuseDigestDeletes(true);
    emitDomainEvent({ type: 'note.excludedFromAI', documentId: DOC_ID, excluded: true });
    await vi.waitFor(() => expect(readPendingLocalPurges(USER)).toHaveLength(1));
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_LOCAL_PURGE_ATTEMPTS; i++) await retryPendingLocalPurges(USER, t0);
    const row = readPendingLocalPurges(USER)![0]!;
    expect(row.attempts).toBe(MAX_LOCAL_PURGE_ATTEMPTS);
    expect(row.nextAt).toBe(t0 + LOCAL_PURGE_SLOW_RETRY_MS);
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ action: 'retryPendingLocalPurges_slow', documentId: DOC_ID }));
    // До срока — не трогается; после — снова пробует и, раз отказ снят, снимает запись.
    refuseDigestDeletes(false);
    expect((await retryPendingLocalPurges(USER, t0 + 1)).purged).toBe(0);
    expect((await retryPendingLocalPurges(USER, t0 + LOCAL_PURGE_SLOW_RETRY_MS)).purged).toBe(1);
    expect(readPendingLocalPurges(USER)).toEqual([]);
  });

  // Снятие исключения, пока заметка в корзине: запись остаётся — заметка всё ещё
  // исключена. Мутация: снимать запись без проверки — красный.
  it('(к) вернули в ИИ, но заметка в корзине — запись остаётся', async () => {
    await seedNote(false);
    const db = await getLocalDb(USER);
    const doc = await db.get('documents', DOC_ID);
    await db.put('documents', { ...doc!, trashedAt: 5 } as any);
    persistPendingLocalPurge(USER, DOC_ID);
    emitDomainEvent({ type: 'note.excludedFromAI', documentId: DOC_ID, excluded: false });
    await new Promise(r => setTimeout(r, 50));
    expect(readPendingLocalPurges(USER)).toHaveLength(1);
  });

  // Грани не прочитались на первой попытке — неизвестно, была ли в них заметка:
  // считаем, что была, и портрет убирается сразу. Мутация: не ставить
  // hadDerivatives в catch граней — портрет на месте, красный.
  it('(л) грани не прочитались — портрет убран сразу, запись помнит грани', async () => {
    await seedNote(true);
    const db = await getLocalDb(USER);
    await db.put('documents', { ...(await db.get('documents', DOC_ID))!, aiProcessed: false } as any);
    await db.clear('aiMonthlyDigest');
    await db.put('aiPortrait', { id: 'singleton', text: 'portrait' } as any);
    facetReadRefusal.active = true;
    emitDomainEvent({ type: 'note.excludedFromAI', documentId: DOC_ID, excluded: true });
    await vi.waitFor(() => expect(readPendingLocalPurges(USER)).toHaveLength(1));
    expect(await db.get('aiPortrait', 'singleton')).toBeUndefined();
    expect(readPendingLocalPurges(USER)![0]).toMatchObject({ facets: true, assume: true });
  });
});
