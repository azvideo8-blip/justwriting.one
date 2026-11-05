// DW-5 (шаг 5 §4.3): эпоху сохранения поднимает мутатор.
//
// Дыра, которую закрывает шаг: сохранение заметки подняло эпоху, а писатель
// называет НЕ эпоху текста, а текущую эпоху на момент записи. Так спасение
// прежнего владельца (W6) внутри окна DY10-10 кладёт уже сохранённый заметкой
// текст обратно в ЕГО строку, а при уже печатающем новом владельце — в его
// LS-копию. Харнесс видит это как `it.fails` DW-10-F-1; здесь тот же класс
// направленным тестом, по адресам: строка `drafts`, копия `draft-<uid>`.
//
// Приёмка шага 5, пункт 1: после принятого сохранения ни один писатель, снявший
// эпоху до сохранения, не меняет ни один адрес (проба «до/после»).
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUser } from '../../../../core/auth/types';
import { getLocalDb, type LocalDraft } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import { WritingDraftService } from '../../services/WritingDraftService';
import { cleanupDraftsAfterSave } from '../../utils/sessionActions';
import { saveGuestDraftToStorage } from '../../services/GuestDraftService';
import { useContentStore } from '../../store/useContentStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useDraftAutosave } from '../useDraftAutosave';
import { applyWrite, clearEditorTextOwner, markEditorTextOwner, resolve } from '../../services/draftWriter';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/auth/accountReload', () => ({
  onBeforeAccountReload: () => () => {},
  isAccountReloadPending: () => false,
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'mobile' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: { syncOne: vi.fn().mockResolvedValue('dw51-cloud-doc'), addToQueue: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));

const cloud = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, saves: 0, deletes: 0 }));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => cloud.row,
    saveDraft: async () => { cloud.saves++; return null; },
    updateDraft: async () => {},
    deleteDraft: async () => { cloud.deletes++; cloud.row = null; },
  },
}));

const T0_STAMP = 1_800_000_000_000;
const A = 'u_dw51_A';
const B = 'u_dw51_B';
const GUEST = 'guest_dw51';
const userA = { uid: A } as AppUser;
const userB = { uid: B } as AppUser;
const SAVED = 'DW51 сохранённый заметкой текст, который не имеет права вернуться';

const draftData = {
  title: '',
  content: SAVED,
  pinnedThoughts: [] as string[],
  seconds: 5,
  wpm: 12,
  wordCount: 9,
  initialWordCount: 0,
  sessionStartTime: undefined,
  activeSessionId: null,
  status: 'writing' as const,
};

const settle = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });

/** Все адреса, откуда сохранённый текст не имеет права вернуться (приёмка 2). */
async function addresses(uid: string): Promise<{ row: string | null; copy: string | null }> {
  const db = await getLocalDb(uid);
  const row = db.objectStoreNames.contains('drafts') ? await db.get('drafts', uid) : undefined;
  let copy: Record<string, unknown> | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DRAFT(uid));
    copy = raw ? JSON.parse(raw) as Record<string, unknown> : null;
  } catch { copy = { content: 'NOT_PARSED' }; }
  return { row: (row as LocalDraft | undefined)?.content ?? null, copy: (copy?.content as string | undefined) ?? null };
}

async function guestAddresses(): Promise<{ row: string | null; copy: string | null }> {
  const db = await getLocalDb();
  const row = db.objectStoreNames.contains('drafts')
    ? await db.get('drafts', 'guest_draft') as LocalDraft | undefined : undefined;
  let copy: Record<string, unknown> | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT);
    copy = raw ? JSON.parse(raw) as Record<string, unknown> : null;
  } catch { copy = { content: 'NOT_PARSED' }; }
  return { row: row?.content ?? null, copy: (copy?.content as string | undefined) ?? null };
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  cloud.row = null;
  cloud.saves = 0;
  cloud.deletes = 0;
  clearEditorTextOwner();
  useEncryptionStore.setState({ encryptionEnabled: {} });
  useContentStore.setState({ content: SAVED, title: '', wordCount: 9, tags: [], labelId: undefined, ownerUid: A });
  useTimerStore.setState({ status: 'writing' });
  useSessionMetaStore.getState().resetSessionMetadata();
  for (const uid of [A, B]) {
    const db = await getLocalDb(uid);
    await db.clear('drafts');
  }
  await (await getLocalDb()).clear('drafts');
});

describe('DW5-1: сохранение подняло эпоху — писатель, снявший её до сохранения, не меняет ни одного адреса', () => {
  /**
   * DW-10-F-1 по адресам, без харнесса: A печатает, сохранение заметки закрыло
   * черновик (строка удалена, эпоха поднята мутатором), в этой же вкладке
   * включается B. Спасение прежнего владельца обязано отвергаться как запись с
   * эпохой текста (до сохранения), а не с текущей.
   */
  it('спасение прежнего владельца в окне сохранения не возвращает сохранённый текст в строку A', async () => {
    markEditorTextOwner(A);
    const { rerender } = renderHook(
      ({ user, data }: { user: AppUser; data: typeof draftData }) => useDraftAutosave(user, data),
      { initialProps: { user: userA, data: draftData } },
    );
    await settle(1_300);
    expect((await addresses(A)).row, 'черновик A не записан до сохранения').toBe(SAVED);

    // Окно DY10-10: savedDocumentId → стирание черновика (мутатор поднял эпоху),
    // сброса сессии ещё не было, текст в сторах тот же.
    useSessionMetaStore.getState().setSavedDocumentId('dw51-doc');
    await act(async () => { await cleanupDraftsAfterSave(A, false, null); });
    expect((await addresses(A)).row, 'стирание черновика не состоялось').toBeNull();

    // Смена аккаунта в этой же вкладке — спасение для A.
    rerender({ user: userB, data: draftData });
    await settle(200);

    const after = await addresses(A);
    expect(after.row, `сохранённый текст вернулся черновиком A: ${JSON.stringify(after)}`).not.toBe(SAVED);
    expect(after.copy, `сохранённый текст вернулся копией A: ${JSON.stringify(after)}`).not.toBe(SAVED);
    const b = await addresses(B);
    expect(b.row, 'текст A попал в строку B (I3)').toBeNull();
    expect(b.copy, 'текст A попал в копию B (I3)').toBeNull();
    expect(useContentStore.getState().content, 'текст A вернулся на экран под B').toBe('');
    // Приёмка 2 конца в конец: загрузка обязана не найти черновика ни в одном
    // адресе — строка, копия, облако и надгробие сверяются вместе.
    expect(await resolve(A), 'черновик A воскрес при загрузке').toBeNull();
    // Надгробие — адрес того же удаления: оно хранит время и хэши, и в него не
    // должен попасть открытый текст (D2 в карте писателей).
    for (const key of [STORAGE_KEYS.DRAFT_DELETED(A), STORAGE_KEYS.DRAFT_DELETED_PERSISTENT(A)]) {
      const value = localStorage.getItem(key) ?? sessionStorage.getItem(key) ?? '';
      expect(value, `в надгробие ${key} лёг текст`).not.toContain(SAVED);
    }
  });

  /**
   * Вторая ветка того же спасения: новый владелец уже печатает, поэтому снимок
   * прежнего идет в его LS-копию (`draft-<A>`). Запись копии эпоху не называла
   * вовсе — то есть проходила мимо правила.
   */
  it('спасение в копию прежнего владельца при печати нового не пишет сохранённый текст', async () => {
    localStorage.setItem(STORAGE_KEYS.ENC_ENABLED(A), '0');
    markEditorTextOwner(A);
    const { rerender } = renderHook(
      ({ user, data }: { user: AppUser; data: typeof draftData }) => useDraftAutosave(user, data),
      { initialProps: { user: userA, data: draftData } },
    );
    await settle(1_300);

    useSessionMetaStore.getState().setSavedDocumentId('dw51-doc');
    await act(async () => { await cleanupDraftsAfterSave(A, false, null); });

    rerender({ user: userB, data: draftData });
    // B успевает напечатать, пока спасение A в полёте.
    useContentStore.getState().setContent('DW51 слова B');
    await settle(200);

    expect((await addresses(A)).copy, 'сохранённый текст лёг в копию draft-<A>').not.toBe(SAVED);
    expect((await addresses(A)).row, 'сохранённый текст лёг в строку A').not.toBe(SAVED);
  });

  /**
   * Гость — тот же адресный набор (`jw_guest_draft` + строка `guest_draft`),
   * и снятая до сохранения эпоха обязана отвергаться так же.
   */
  it('гостевая отсрочка после сохранения заметки не возвращает текст ни в один гостевой адрес', async () => {
    const epochAtEdit = WritingDraftService.getDraftGeneration(GUEST);
    await saveGuestDraftToStorage(
      { content: SAVED, title: '', wordCount: 9, timestamp: 1_700_000_000_000 },
      { uid: GUEST, epoch: epochAtEdit },
    );
    expect((await guestAddresses()).copy, 'гостевой черновик не записан до сохранения').toBe(SAVED);

    await act(async () => { await cleanupDraftsAfterSave(GUEST, true, null); });
    expect(await guestAddresses(), 'гостевые адреса не стёрты').toEqual({ row: null, copy: null });

    // Опоздавшая запись той же отсрочки — с эпохой, снятой до сохранения.
    await saveGuestDraftToStorage(
      { content: SAVED, title: '', wordCount: 9, timestamp: 1_700_000_001_000 },
      { uid: GUEST, epoch: epochAtEdit },
    );
    const after = await guestAddresses();
    expect(after.copy, `сохранённый текст вернулся гостевым черновиком: ${JSON.stringify(after)}`).not.toBe(SAVED);
    expect(after.row, `сохранённый текст вернулся строкой guest_draft: ${JSON.stringify(after)}`).not.toBe(SAVED);
    expect(await resolve(GUEST, { guest: true }), 'гостевой черновик воскрес при загрузке').toBeNull();
  });

  /**
   * Узкая форма правила (§4.1): отвергается запись с эпохой РАНЬШЕ текущей, а не
   * «любая не текущая». Иначе строка, приехавшая из прошлой вкладки (её отметка 7,
   * а карта эпох новой вкладки начинается с нуля), была бы неперезаписываемой —
   * то есть её текст нельзя было бы ни сохранить, ни убрать.
   */
  it('запись с эпохой прошлой вкладки (карта новой — ноль) проходит', async () => {
    const uid = 'u_dw51_stale_row';
    const outcome = await applyWrite(
      { content: SAVED, owner: uid, epoch: 7, updatedAt: T0_STAMP },
      'edit',
      { uid },
    );
    expect(outcome, 'правило `!==` вернулось бы сюда красным').toBe('written');
    expect((await addresses(uid)).row, 'строка не записана').toBe(SAVED);
  });
});
