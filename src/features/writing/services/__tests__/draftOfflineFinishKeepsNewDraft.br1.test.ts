// BR-1 (ревью 25.10): офлайн-финиш терял НОВЫЙ черновик. Без сети
// `cleanupDraftsAfterSave` зовёт только локальную половину удаления, а
// `writeTombstone` отметку досылки не ставит — старая облачная строка живёт.
// При следующей загрузке `loadDraft` находит новый локальный + старый облачный,
// спор выигрывает облако (тот же хэш, что под надгробием), и ветка
// «удалённый черновик» сносит `deleteDraft` целиком — вместе с новым текстом.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { WritingDraftService } from '../WritingDraftService';
import { applyDelete, resolve } from '../draftWriter';

const realNow = Date.now;

const cloud = vi.hoisted(() => ({
  row: null as LocalDraft | null,
  deletes: 0,
}));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => cloud.row,
    saveDraft: async () => null,
    updateDraft: async () => {},
    deleteDraft: async () => {
      cloud.deletes++;
      cloud.row = null;
    },
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

const UID = 'u_br1';
const T0 = Date.UTC(2026, 9, 25, 6, 0, 0);
const base = (over: Partial<LocalDraft>): LocalDraft => ({
  userId: UID, owner: UID, title: '', content: '', seconds: 60, wpm: 40, wordCount: 1,
  pinnedThoughts: [], tags: [], activeSessionId: null, savedDocumentId: null,
  updatedAt: T0, ...over,
});
/** Старый черновик, который человек сохранил заметкой офлайн. */
const oldDraft = () => base({ content: 'СТАРЫЙ_ЧЕРНОВИК_КОТОРЫЙ_СОХРАНИЛИ_ЗАМЕТКОЙ_ОФЛАЙН', wordCount: 20, updatedAt: T0 - 30_000 });
/** Новая работа: несколько слов, служебных облачных полей нет. Написана через
 *  10 с после финиша — под надгробием по времени она не лежит. */
const newDraft = () => base({ content: 'новая запись', wordCount: 2, updatedAt: T0 + 10_000 });

async function localRow(): Promise<LocalDraft | undefined> {
  const db = await getLocalDb(UID);
  return db.objectStoreNames.contains('drafts') ? await db.get('drafts', UID) : undefined;
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  cloud.row = null;
  cloud.deletes = 0;
  Date.now = () => T0;
});

afterEach(() => { Date.now = realNow; });

describe('BR-1 (а): офлайн-финиш оставляет отметку досылки облачного удаления', () => {
  it('после локальной половины удаления отметка стоит, и при следующей загрузке облако сносится', async () => {
    await WritingDraftService.saveToLocal(oldDraft());
    cloud.row = oldDraft();

    const deleted = await applyDelete(UID, 'close', { part: 'local' });

    expect(deleted.localOk).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(UID)), 'отметка досылки без сети').not.toBeNull();

    const loaded = await resolve(UID);
    expect(loaded).toBeNull();
    expect(cloud.deletes, 'старая облачная строка снесена досылкой').toBe(1);
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(UID)), 'досылка закрыта').toBeNull();
  });
});

describe('BR-1 (б): облачный победитель под надгробием не сносит новый локальный черновик', () => {
  it('новый локальный + старый облачный → loadDraft отдаёт новый и удаляет только облако', async () => {
    await WritingDraftService.saveToLocal(oldDraft());
    await applyDelete(UID, 'close', { part: 'local' });
    // Отметку досылки снимаем руками: ветку (б) проверяем отдельно — так она
    // выглядит, когда облачная строка приехала обратно (другое устройство).
    localStorage.removeItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(UID));
    cloud.row = oldDraft();
    await WritingDraftService.saveToLocal(newDraft());

    const loaded = await resolve(UID);

    expect(loaded?.content, 'текст новой работы вернулся').toBe('новая запись');
    expect(cloud.deletes, 'облачная строка под надгробием удалена').toBe(1);
    expect(await localRow(), 'локальный черновик цел').toBeTruthy();
  });
});
