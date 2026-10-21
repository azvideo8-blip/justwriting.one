import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { resetDbInstance, type LocalDraft } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { WritingDraftService } from '../WritingDraftService';

const realNow = Date.now;

const cloud = vi.hoisted(() => ({
  row: null as LocalDraft | null,
  failDeletes: 1,
  deletes: 0,
}));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => cloud.row,
    saveDraft: async () => null,
    updateDraft: async () => {},
    deleteDraft: async () => {
      cloud.deletes++;
      if (cloud.failDeletes > 0) {
        cloud.failDeletes--;
        throw new Error('cloud unavailable');
      }
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

const UID = 'u_ap2_4';
const T0 = Date.UTC(2026, 9, 21, 6, 0, 0);
const draft = (): LocalDraft => ({
  userId: UID, title: '', content: 'AP2_DRAFT_SYNTHETIC', seconds: 60, wpm: 40,
  wordCount: 3, pinnedThoughts: [], tags: [], activeSessionId: null, savedDocumentId: null,
  updatedAt: T0,
});

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  resetDbInstance();
  cloud.row = draft();
  cloud.failDeletes = 1;
  cloud.deletes = 0;
  // Тест зависел от реальных часов: надгробие пишет Date.now(), и после
  // T0+60s того же дня ветка «удалённое раньше нового облачного» делала
  // второе удаление — base CI был зелёным только потому, что гонял vitest
  // в 05:06Z, до 06:01Z. Часы замирают на минуту до T0.
  Date.now = () => T0 - 60_000;
  await WritingDraftService.saveToLocal(draft());
});

afterEach(() => { Date.now = realNow; });

describe('AP2-4: удалённый черновик не воскресает в новой вкладке', () => {
  it('облако не приняло удаление — надгробие переживает вкладку, удаление досылается', async () => {
    const first = await WritingDraftService.deleteDraft(UID);
    expect(first).toEqual({ localOk: true, cloudOk: false });
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(UID)), 'досылка поставлена').not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETED_PERSISTENT(UID)), 'надгробие без текста').toContain('|');
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETED_PERSISTENT(UID))).not.toContain('AP2_DRAFT_SYNTHETIC');

    sessionStorage.clear();
    const loaded = await WritingDraftService.loadDraft(UID);
    expect(loaded, 'в новой вкладке черновик не возвращается').toBeNull();
    expect(cloud.deletes, 'облачное удаление дослано').toBe(2);
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(UID)), 'досылка закрыта').toBeNull();
  });

  it('досылка не удалась снова — черновик всё равно не возвращается', async () => {
    cloud.failDeletes = 3;
    await WritingDraftService.deleteDraft(UID);
    sessionStorage.clear();
    expect(await WritingDraftService.loadDraft(UID)).toBeNull();
    expect(cloud.deletes).toBe(3);
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(UID))).not.toBeNull();
  });

  // Приёмка 0.10.6 (security-review): после неудачного удаления в облако уехал
  // НОВЫЙ черновик (другое устройство или этот же) — досылка удаления его не
  // стирает, а отметка снимается. Мутация: удалять без сверки хэша — красный.
  it('новый черновик в облаке после неудачного удаления досылкой не стирается', async () => {
    await WritingDraftService.deleteDraft(UID);
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(UID))).not.toBeNull();
    cloud.row = { ...draft(), content: 'НОВЫЙ_ЧЕРНОВИК_С_ДРУГОГО_УСТРОЙСТВА', updatedAt: T0 + 60_000 };
    sessionStorage.clear();

    await WritingDraftService.loadDraft(UID);

    expect(cloud.deletes, 'второго удаления нет').toBe(1);
    expect(cloud.row?.content).toBe('НОВЫЙ_ЧЕРНОВИК_С_ДРУГОГО_УСТРОЙСТВА');
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETE_PENDING(UID)), 'отметка снята').toBeNull();
  });

  // Ревью AP2 L6: повторное удаление без локальной строки не стирает хэши
  // прежнего — иначе остаётся одно правило по часам устройства.
  it('повторное удаление сохраняет хэши удалённого содержимого', async () => {
    await WritingDraftService.deleteDraft(UID);
    const first = localStorage.getItem(STORAGE_KEYS.DRAFT_DELETED_PERSISTENT(UID))!.split('|')[1]!;
    expect(first).toMatch(/^[0-9a-f]{16}/);
    await WritingDraftService.deleteDraft(UID);
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT_DELETED_PERSISTENT(UID))).toContain(first);
  });
});
