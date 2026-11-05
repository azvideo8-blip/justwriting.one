// DW6-1 (шаг 6 §4.3): `applyDelete` — единственное удаление, и оно стоит В
// очереди правок строки (`queueDraftRowWrite`). Приёмка §4.3 строка 6:
//  1) после удаления и перезагрузки редактор пуст, `drafts` и `draft-<uid>`
//     очищены, надгробие живёт в Persistent-ключе — аккаунт и гость;
//  5) запись, вставшая до удаления, строку не возвращает; удаление, вставшее
//     до записи новой сессии, новую строку не сносит.
// Мутация (приёмка 6): вернуть удаление мимо очереди — кейс «фон не воскресит
// удалённое» красный; снять надгробие в `applyDelete` — красный кейс перезагрузки.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { WritingDraftService } from '../WritingDraftService';
import {
  applyDelete,
  applyWrite,
  getDraftGeneration,
  queueDraftRowWrite,
  readTombstone,
  resolve,
  type DraftRecord,
} from '../draftWriter';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const cloud = vi.hoisted(() => ({ deletes: 0, saves: 0, row: null as Record<string, unknown> | null }));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => cloud.row,
    saveDraft: async (uid: string, payload: Record<string, unknown>) => { cloud.saves++; cloud.row = { ...payload, userId: uid }; return null; },
    updateDraft: async () => {},
    deleteDraft: async () => { cloud.deletes++; cloud.row = null; },
  },
}));

const realNow = Date.now;
const T0 = 1_800_000_000_000;

async function storedRow(uid: string, key = uid): Promise<Record<string, unknown> | undefined> {
  const db = await getLocalDb(uid);
  return (await db.get('drafts', key)) as Record<string, unknown> | undefined;
}

async function seed(uid: string, key: string, content: string, copyKey: string | null): Promise<void> {
  const db = await getLocalDb(uid);
  await db.put('drafts', {
    userId: key, owner: uid, content, title: '', seconds: 10, wpm: 20, wordCount: 3,
    pinnedThoughts: [], tags: [], activeSessionId: null, updatedAt: T0 - 5_000,
  } as unknown as LocalDraft);
  if (copyKey) localStorage.setItem(copyKey, JSON.stringify({ content }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  vi.clearAllMocks();
  cloud.deletes = 0;
  cloud.saves = 0;
  cloud.row = null;
  Date.now = () => T0;
});

afterEach(() => {
  Date.now = realNow;
});

describe('DW6-1 приёмка 1: после «Удалить» не остаётся ни одного адреса', () => {
  it('аккаунт: строка, LS-дубль и облако чищены, надгробие переживает смерть вкладки', async () => {
    const uid = 'u_dw61_acct';
    await seed(uid, uid, 'УДАЛЯЕМЫЙ_ТЕКСТ_DW61', STORAGE_KEYS.DRAFT(uid));
    cloud.row = { userId: uid, content: 'УДАЛЯЕМЫЙ_ТЕКСТ_DW61', wordCount: 3, updatedAt: T0 - 5_000 };

    const res = await applyDelete(uid, 'close');
    expect(res).toEqual({ localOk: true, cloudOk: true });
    expect(await storedRow(uid), 'строка `drafts` осталась').toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(uid)), 'LS-дубль `draft-<uid>` остался').toBeNull();
    expect(cloud.row, 'облачная строка осталась').toBeNull();

    // «Перезагрузка»: вкладка умерла — sessionStorage нет, остаётся Persistent-ключ.
    sessionStorage.clear();
    expect(readTombstone(uid), 'надгробие не живо в Persistent-ключе').not.toBeNull();
    expect((readTombstone(uid)!.hashes.length), 'надгробие без хэша удалённого содержимого').toBeGreaterThan(0);
    expect(await resolve(uid), 'удалённое вернулось из облака').toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(uid)), 'BR-1а: отметка после удачного облака').toBeNull();
  });

  it('гость: оба гостевых адреса чищены, надгробия и облачной доски нет (D6)', async () => {
    const uid = 'guest_dw61';
    await seed(uid, 'guest_draft', 'ГОСТЕВОЙ_УДАЛЯЕМЫЙ_DW61', STORAGE_KEYS.GUEST_DRAFT);

    const res = await applyDelete(uid, 'close', { guest: true });
    expect(res.localOk).toBe(true);
    expect(await storedRow(uid, 'guest_draft'), 'строка `guest_draft` осталась').toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT), 'ключ `jw_guest_draft` остался').toBeNull();
    expect(readTombstone(uid), 'гостю написано надгробие').toBeNull();
    expect(cloud.deletes, 'гостевое удаление тронуло облако').toBe(0);
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(uid)), 'гостю поставлена отметка досылки').toBeNull();
  });
});

describe('DW6-1 приёмка 5: удаление стоит в очереди правок строки', () => {
  it('adopt-запись, вставшая в очередь до удаления, не возвращает удалённую строку', async () => {
    const uid = 'u_dw61_queue';
    await seed(uid, uid, 'ПРЕЖНИЙ_ТЕКСТ_DW61', null);

    // Очередь занята: фоновое принятие облачной копии уже встало в цепочку и ждёт.
    let release!: () => void;
    const hold = new Promise<void>(res => { release = res; });
    void queueDraftRowWrite(async () => { await hold; });

    // У этой записи своей эпохи нет (basis 'adopt-cloud' — копия пришла извне),
    // поэтому правило эпохи её не держит: держать должен только порядок очереди.
    const adopting = applyWrite(
      { content: 'ОБЛАЧНАЯ_КОПИЯ_DW61', owner: uid, updatedAt: T0 - 1_000 } as DraftRecord,
      'adopt-cloud',
      { uid },
    );
    await new Promise(r => { setTimeout(r, 25); });

    const deleting = applyDelete(uid, 'close');
    // Пока очередь держат, удаление обязано ждать: без очереди оно успевает
    // сработать здесь, и освободившаяся adopt-запись вернёт удалённую строку.
    await new Promise(r => { setTimeout(r, 25); });
    expect(await storedRow(uid), 'удаление не ждало очереди — строку снесло до фоновой записи').toBeDefined();
    release();
    await Promise.all([adopting, deleting]);

    expect(await storedRow(uid), 'удалённая строка воскресла из очереди (удаление шло мимо неё)').toBeUndefined();
  });

  it('удаление, вставшее до записи новой сессии, новую строку не сносит', async () => {
    const uid = 'u_dw61_newsession';
    const deleted = applyDelete(uid, 'close');
    const epoch = getDraftGeneration(uid);
    const written = applyWrite(
      { content: 'НОВАЯ_СЕССИЯ_DW61', owner: uid, epoch, updatedAt: T0 } as DraftRecord,
      'edit',
      { uid, epoch },
    );
    await Promise.all([deleted, written]);
    expect(await storedRow(uid), 'удаление снесло строку новой сессии').toBeUndefined();

    // …а запись, сделанная ПОСЛЕ удаления (тот же поднятый им счётчик), живёт.
    const after = applyWrite(
      { content: 'ПОСЛЕ_УДАЛЕНИЯ_DW61', owner: uid, epoch: getDraftGeneration(uid), updatedAt: T0 + 1 } as DraftRecord,
      'edit',
      { uid, epoch: getDraftGeneration(uid) },
    );
    expect(await after).toBe('written');
    expect(((await storedRow(uid))?.content), 'запись после удаления не легла').toBe('ПОСЛЕ_УДАЛЕНИЯ_DW61');
  });
});

describe('DW6-1: подъём эпохи и тормоз облачной квоты', () => {
  it('удаление поднимает эпоху и снимает подпись последней отправки', async () => {
    const uid = 'u_dw61_epoch';
    const before = getDraftGeneration(uid);
    const same = { userId: uid, owner: uid, content: 'Тот же текст', title: '', wordCount: 2, updatedAt: T0 } as unknown as LocalDraft;

    await WritingDraftService.saveDraftToCloud(same);
    expect(cloud.saves, 'первая запись не уехала в облако').toBe(1);
    await WritingDraftService.saveDraftToCloud(same);
    expect(cloud.saves, 'тот же текст уехал повторно — тормоз квоты сломан').toBe(1);

    await applyDelete(uid, 'post-save');
    expect(getDraftGeneration(uid), 'мутатор не поднял эпоху').toBeGreaterThan(before);
    await WritingDraftService.saveDraftToCloud(same);
    // Следующая сессия с тем же текстом обязана уехать в облако, а не получить
    // «ничего не изменилось» отправки, которая уже была удалена.
    expect(cloud.saves, 'после удаления подпись последней отправки не снята').toBe(2);
  });

  it('пустой uid — ничего не сделано, без исключения', async () => {
    const res = await applyDelete('', 'close');
    expect(res).toEqual({ localOk: true, cloudOk: true });
    expect(cloud.deletes).toBe(0);
  });

  it('локальная половина без облачной: отметка досылки остаётся (RA1-2, BR-1а)', async () => {
    const uid = 'u_dw61_pending';
    await seed(uid, uid, 'ОФЛАЙН_УДАЛЕНИЕ_DW61', null);
    const res = await applyDelete(uid, 'post-save', { part: 'local' });
    expect(res.localOk).toBe(true);
    expect(res.cloudOk, 'облако не должно быть тронуто локальной половиной').toBe(true);
    expect(cloud.deletes).toBe(0);
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(uid)), 'BR-1а: отметки нет').not.toBeNull();
  });
});
