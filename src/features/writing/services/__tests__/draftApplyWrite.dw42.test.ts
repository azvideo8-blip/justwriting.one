// DW4-2: мутатор applyWrite — единственный писатель локальных адресов (строка
// IDB и LS-дубль закрытия вкладки). Направленные приёмочные тесты шага:
// опоздавшая запись с прежней эпохой строку не меняет (DY10-10, сверка живёт
// в мутаторе), поля идентичности и _cloud* переживают любую запись, копия
// закрытия пишется синхронно, новее строки и возвращается loadDraft, при
// сейфе копии нет, гостевая копия мутатора — в ключе гостя и той же формы,
// что у отсрочки GuestDraftService.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import { WritingDraftService } from '../WritingDraftService';
import { applyWrite, buildGuestDraftRecord, bumpDraftGeneration, getDraftGeneration } from '../draftWriter';
import { deleteGuestDraftFromStorage, saveGuestDraftToStorage } from '../GuestDraftService';

const realNow = Date.now;

const cloud = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => cloud.row,
    saveDraft: async () => null,
    updateDraft: async () => {},
    deleteDraft: async () => { cloud.row = null; },
  },
}));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

// Фиксированная отметка в прошлом: TTL и надгробие сверяются с часами, и
// живая дата сделала бы тест протухающим (поймано на AP2-4 в CI).
const T0 = 1_800_000_000_000;

function row(content: string, uid: string, updatedAt = T0 - 10_000): LocalDraft {
  return {
    userId: uid, owner: uid, title: '', content, seconds: 60, wpm: 40, wordCount: content.split(' ').length,
    pinnedThoughts: [], tags: [], activeSessionId: null, savedDocumentId: null, updatedAt,
  } as LocalDraft;
}

async function storedRow(uid: string): Promise<Record<string, unknown> | undefined> {
  const db = await getLocalDb(uid);
  return (await db.get('drafts', uid)) as Record<string, unknown> | undefined;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  cloud.row = null;
  // Часы стоят на минуте раньше T0: ни TTL, ни временна́я ветка надгробия не
  // срабатывают сами по себе.
  Date.now = () => T0 - 60_000;
});

afterEach(() => {
  Date.now = realNow;
  useEncryptionStore.setState({ encryptionEnabled: {} });
});

describe('DW4-2 applyWrite: эпоха принадлежит мутатору', () => {
  it('опоздавшая запись строки с прежней эпохой строку НЕ меняет', async () => {
    const uid = 'u_dw42_row';
    bumpDraftGeneration(uid); // сессия письма: эпоха 1

    expect(await WritingDraftService.saveToLocal(row('первая', uid), 1)).toBe('written');
    // Сохранение заметки: эпоха поднята, черновик стёрт.
    bumpDraftGeneration(uid);
    // Отсроченная запись срабатывает в окне после стирания — эпоха у неё прежняя.
    expect(await WritingDraftService.saveToLocal(row('поздняя', uid), 1), 'отказ обязан называть причину').toBe('stale-epoch');

    const stored = await storedRow(uid);
    expect(stored?.content, 'сохранённый текст вернулся черновиком').toBe('первая');
  });

  it('опоздавшая копия закрытия с прежней эпохой ключ не пишет, свежая — пишет', async () => {
    const uid = 'u_dw42_copy';
    bumpDraftGeneration(uid);
    bumpDraftGeneration(uid); // сохранение заметки: эпоха 2

    const outcome = await applyWrite(
      { content: 'поздняя', owner: uid, updatedAt: T0 - 1000 },
      'edit',
      { target: 'copy', uid, epoch: 1 },
    );
    expect(outcome).toBe('stale-epoch');
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(uid)), 'унаследованный ключ вернулся после удаления').toBeNull();

    const fresh = await applyWrite(
      { content: 'свежая', owner: uid, updatedAt: T0 - 1000 },
      'edit',
      { target: 'copy', uid, epoch: 2 },
    );
    expect(fresh).toBe('written');
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(uid))).toContain('свежая');
  });

  it('копия пишется синхронно, до первого await — уход со страницы не ждёт микрозадач', async () => {
    const uid = 'u_dw42_sync';
    const pending = applyWrite(
      { content: 'MARKER_DW42_последние_слова', owner: uid, updatedAt: T0 - 1000 },
      'edit',
      { target: 'copy', uid, epoch: 0 },
    );
    // Снимок закрытия обязан уже лежать в ключе: вкладка может замереть сразу
    // после обработчика pagehide, микрозадачи не досчитают.
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(uid)), 'копия записалась только после await')
      .toContain('MARKER_DW42_последние_слова');
    expect(await pending).toBe('written');
  });
});

describe('DW4-2 applyWrite: чего любая запись не должна ломать', () => {
  it('поля идентичности и _cloud* на месте после правки и после adopt-cloud; epoch в строку не попадает', async () => {
    const uid = 'u_dw42_fields';
    bumpDraftGeneration(uid);
    const acked = 'a'.repeat(16);
    const sent = 'b'.repeat(16);
    await WritingDraftService.saveToLocal({
      ...row('база', uid), savedDocumentId: 'doc-dw42',
      _cloudUpdatedAt: 111, _cloudAckedHash: acked, _cloudSentHashes: [sent],
    }, 1);

    // Отсрочка правки: писатель строит черновик из редактора и служебные
    // метки облака принести не может, а savedDocumentId приносит.
    await WritingDraftService.saveToLocal({ ...row('правка', uid), savedDocumentId: 'doc-dw42' }, 1);
    const afterEdit = await storedRow(uid);
    expect(afterEdit?.content).toBe('правка');
    expect(afterEdit?.savedDocumentId).toBe('doc-dw42');
    expect(afterEdit?._cloudUpdatedAt).toBe(111);
    expect(afterEdit?._cloudAckedHash).toBe(acked);
    expect(afterEdit?._cloudSentHashes).toEqual([sent]);
    expect(afterEdit, 'шаг 2: эпоха — аргумент мутатора, а не поле строки').not.toHaveProperty('epoch');

    // Фоновое кэширование принятой из облака копии — basis adopt-cloud, эпохи
    // не названо: запись проходит, а недостающие служебные поля добираются с
    // прежней строки. Победитель (облако) встаёт целиком — как и раньше.
    const cloudAcked = 'c'.repeat(16);
    await WritingDraftService.saveToLocal({
      ...row('облачная', uid), _cloudUpdatedAt: 222, _cloudAckedHash: cloudAcked, _cloudSentHashes: [cloudAcked],
    });
    const afterAdopt = await storedRow(uid);
    expect(afterAdopt?.content).toBe('облачная');
    expect(afterAdopt?._cloudUpdatedAt).toBe(222);
    expect(afterAdopt?._cloudAckedHash).toBe(cloudAcked);
  });

  it('при pagehide копия новее строки, и loadDraft возвращает её', async () => {
    const uid = 'u_dw42_newer';
    bumpDraftGeneration(uid);
    await WritingDraftService.saveToLocal(row('строка', uid, T0 - 10_000), 1);

    const outcome = await applyWrite(
      { content: 'раз два', owner: uid, updatedAt: T0 },
      'edit',
      { target: 'copy', uid, epoch: 1 },
    );
    expect(outcome).toBe('written');

    const stored = await storedRow(uid);
    const copy = JSON.parse(localStorage.getItem(STORAGE_KEYS.DRAFT(uid)) ?? '{}') as { updatedAt?: number };
    expect(copy.updatedAt ?? 0, 'копия закрытия не новее строки').toBeGreaterThan(Number(stored?.updatedAt ?? 0));

    const restored = await WritingDraftService.loadDraft(uid);
    expect(restored?.content).toBe('раз два');
  });

  it('при сейфе копии нет и ключ стёрт — а строка пишется («нет дубля» ≠ «запись не нужна»)', async () => {
    const uid = 'u_dw42_vault';
    bumpDraftGeneration(uid);
    useEncryptionStore.setState({ encryptionEnabled: { [uid]: true } });
    localStorage.setItem(STORAGE_KEYS.DRAFT(uid), 'MARKER_DW42_старый_открытый_снимок');

    const outcome = await applyWrite(
      { content: 'MARKER_DW42_открытый_текст', owner: uid, updatedAt: T0 - 1000 },
      'edit',
      { target: 'copy', uid, epoch: 1 },
    );
    expect(outcome).toBe('vault-cleared');
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(uid)), 'при сейфе открытая копия осталась').toBeNull();

    expect(await WritingDraftService.saveToLocal(row('строка при сейфе', uid), 1)).toBe('written');
    expect((await storedRow(uid))?.content, 'сейф отменил запись строки').toBe('строка при сейфе');
  });

  it('гостевая копия мутатора — в ключе гостя и той же формы, что у отсрочки; ключ аккаунта гостю не пишется', async () => {
    const guest = 'guest_dw42';
    bumpDraftGeneration(guest);
    const fields = {
      content: 'MARKER_DW42_гость', title: 'Гость', seconds: 42, status: 'writing',
      wordCount: 5, pinnedThoughts: [], tags: [], labelId: undefined,
      savedDocumentId: 'doc-guest-dw42', accumulatedDuration: 40, totalPauseSeconds: 2,
      initialWordCount: 0, activeSessionId: null, sessionStartTime: null,
    };

    await saveGuestDraftToStorage({ ...fields, timestamp: T0 - 1000 }, { uid: guest });
    const deferred = JSON.parse(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT) ?? '{}') as Record<string, unknown>;

    localStorage.removeItem(STORAGE_KEYS.GUEST_DRAFT);
    const outcome = await applyWrite(buildGuestDraftRecord({ ...fields, owner: guest, timestamp: T0 - 1000 }), 'edit', {
      target: 'copy', uid: guest, epoch: 1,
    });
    expect(outcome).toBe('written');

    const unloadCopy = JSON.parse(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT) ?? '{}') as Record<string, unknown>;
    expect(unloadCopy.content).toBe('MARKER_DW42_гость');
    expect(unloadCopy.savedDocumentId).toBe('doc-guest-dw42');
    expect(Object.keys(unloadCopy).sort(), 'форма копии мутатора разошлась с формой отсрочки (DW-F-2)')
      .toEqual(Object.keys(deferred).sort());
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(guest)), 'гостю написан мёртвый ключ аккаунта').toBeNull();
  });

  it('гостевая отсрочка называет эпоху мутатору: опоздавшая запись не пишет ни в один адрес, свежая — пишет', async () => {
    // Заметка ревьюера 03.11 13:55 (сид 103):GuestDraftService через onSaveDraft
    // обязан называть эпоху мутатору — снятие writer-стража не должно вернуть
    // класс «поздняя запись в окне сохранения».
    const guest = 'guest_dw42_late';
    // Строка `guest_draft` — один ключ на всех гостевых тестов файла, а
    // fake-indexeddb переживает resetDbInstance: чистим оба адреса явно.
    await deleteGuestDraftFromStorage();
    const fields = {
      content: 'MARKER_DW42_поздняя', title: 'Гость', seconds: 5, status: 'writing',
      wordCount: 2, pinnedThoughts: [], tags: [],
    };
    const epochAtEdit = getDraftGeneration(guest);
    bumpDraftGeneration(guest); // сохранение заметки подняло поколение

    await saveGuestDraftToStorage({ ...fields, timestamp: T0 - 1000 }, { uid: guest, epoch: epochAtEdit });

    const db = await getLocalDb(guest);
    const staleRow = (await db.get('drafts', 'guest_draft')) as Record<string, unknown> | undefined;
    expect(staleRow?.content, 'опоздавшая отсрочка записала строку IDB').toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT), 'опоздавшая отсрочка записала LS-ключ').toBeNull();

    await saveGuestDraftToStorage(
      { ...fields, timestamp: T0 - 1000 },
      { uid: guest, epoch: getDraftGeneration(guest) },
    );
    const freshRow = (await db.get('drafts', 'guest_draft')) as Record<string, unknown> | undefined;
    expect(freshRow?.content).toBe('MARKER_DW42_поздняя');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT) ?? '{}'))
      .toMatchObject({ content: 'MARKER_DW42_поздняя' });
  });
});
