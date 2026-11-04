// DW5-2 (билет DW-5, шаг 5): окно сейфа у спасения — снимок прежнего владельца
// обязан дождаться повтора, а не жить только в памяти вкладки.
//
// Правка ревьюера `f01bd41a`: запись спасения не прошла, а новый аккаунт уже
// печатает → снимок ложится в `draft-<prev>`, только если сейф прежнего ЯВНО
// выключен (`vaultKnownOff`); иначе открытой копии нет (SEC-56) и снимок живёт в
// `rescuePayloads` до закрытия вкладки. Это и есть названное окно §6.1.
//
// Повтор возможен без открытого текста на диске: строка IndexedDB прежнего
// владельца — не запрещённый адрес (её пишет обычное автосохранение), а
// `rescuePayloads` уже хранит снимок с его owner и эпохой. Значит следующая
// попытка автосохранения (и уход в фон) обязана донести её до базы прежнего.
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUser } from '../../../../core/auth/types';
import { getLocalDb, type LocalDraft } from '../../../../core/storage/localDb';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import { WritingDraftService } from '../../services/WritingDraftService';
import { useContentStore } from '../../store/useContentStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useDraftAutosave } from '../useDraftAutosave';
import { clearEditorTextOwner, markEditorTextOwner } from '../../services/draftWriter';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../../../core/auth/accountReload', () => ({
  onBeforeAccountReload: () => () => {},
  isAccountReloadPending: () => false,
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'mobile' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: { syncOne: vi.fn().mockResolvedValue('dw52-cloud-doc'), addToQueue: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));
vi.mock('../../../../core/data', () => ({
  DataProvider: {
    getDraft: async () => null,
    saveDraft: async () => null,
    updateDraft: async () => {},
    deleteDraft: async () => {},
  },
}));

const A = 'u_dw52_A';
const B = 'u_dw52_B';
const userA = { uid: A } as AppUser;
const userB = { uid: B } as AppUser;
const FIRST = 'DW52 первая половина набора A';
const UNSAVED = 'DW52 последние слова A, до которых запись не дожила';
const B_WORDS = 'DW52 слова нового владельца B';

const dataOf = (content: string) => ({
  title: '',
  content,
  pinnedThoughts: [] as string[],
  seconds: 5,
  wpm: 12,
  wordCount: content.split(/\s+/).length,
  initialWordCount: 0,
  sessionStartTime: undefined,
  activeSessionId: null,
  status: 'writing' as const,
});

const settle = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });

async function rowContent(uid: string): Promise<string | null> {
  const db = await getLocalDb(uid);
  const row = db.objectStoreNames.contains('drafts') ? await db.get('drafts', uid) : undefined;
  return (row as LocalDraft | undefined)?.content ?? null;
}

const realSaveToLocal = WritingDraftService.saveToLocal.bind(WritingDraftService);
/** Один отказ записи строки A — ровно тот, из-за которого снимок уходит в память. */
function failNextAccountRowWrite() {
  let armed = true;
  vi.spyOn(WritingDraftService, 'saveToLocal').mockImplementation(async (draft, generation) => {
    if (armed && draft.userId === A) {
      armed = false;
      throw new Error('DW52: IndexedDB отказал');
    }
    return realSaveToLocal(draft, generation);
  });
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  clearEditorTextOwner();
  // Сейф не назван выключенным = считаем включённым: открытой копии нет (§6.1).
  useEncryptionStore.setState({ encryptionEnabled: {} });
  useContentStore.setState({ content: FIRST, title: '', wordCount: 4, tags: [], labelId: undefined, ownerUid: A });
  useTimerStore.setState({ status: 'writing' });
  useSessionMetaStore.getState().resetSessionMetadata();
  for (const uid of [A, B]) {
    const db = await getLocalDb(uid);
    await db.clear('drafts');
  }
});

describe('DW5-2: отказ записи спасения при сейфе — снимок доносит до базы прежнего владельца', () => {
  it('следующая попытка автосохранения дописывает снимок A в его строку', async () => {
    markEditorTextOwner(A);
    const { rerender } = renderHook(
      ({ user, data }: { user: AppUser; data: ReturnType<typeof dataOf> }) => useDraftAutosave(user, data),
      { initialProps: { user: userA, data: dataOf(FIRST) } },
    );
    await settle(1_300);
    expect(await rowContent(A), 'черновик A не записан до смены аккаунта').toBe(FIRST);

    // A дописал текст, а запись не состоялась: спасение упрётся в отказ базы.
    useContentStore.getState().setContent(UNSAVED);
    rerender({ user: userA, data: dataOf(UNSAVED) });
    await settle(10);
    failNextAccountRowWrite();

    // Смена аккаунта в этой же вкладке + новый владелец сразу печатает.
    rerender({ user: userB, data: dataOf(UNSAVED) });
    useContentStore.getState().setContent(B_WORDS);
    rerender({ user: userB, data: dataOf(B_WORDS) });
    await settle(50);

    expect(await rowContent(A), 'отказанное спасение дошло до строки A без повтора').toBe(FIRST);
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(A)), 'открытая копия A при сейфе запрещена (SEC-56)').toBeNull();

    // Следующая попытка автосохранения (отсрочка B) обязана донести снимок A.
    await settle(1_500);

    expect(await rowContent(A), 'снимок A так и не был повторен в его базу').toBe(UNSAVED);
    expect(await rowContent(B), 'работа B потеряна').toBe(B_WORDS);
    expect(localStorage.getItem(STORAGE_KEYS.DRAFT(A)), 'повтор записал открытый текст в LS при сейфе').toBeNull();
  });

  it('уход в фон повторяет снимок прежнего владельца', async () => {
    markEditorTextOwner(A);
    const { rerender } = renderHook(
      ({ user, data }: { user: AppUser; data: ReturnType<typeof dataOf> }) => useDraftAutosave(user, data),
      { initialProps: { user: userA, data: dataOf(FIRST) } },
    );
    await settle(1_300);
    useContentStore.getState().setContent(UNSAVED);
    rerender({ user: userA, data: dataOf(UNSAVED) });
    await settle(10);
    failNextAccountRowWrite();

    rerender({ user: userB, data: dataOf(UNSAVED) });
    useContentStore.getState().setContent(B_WORDS);
    rerender({ user: userB, data: dataOf(B_WORDS) });
    await settle(50);

    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    spy.mockRestore();
    await settle(200);

    expect(await rowContent(A), 'уход в фон не повторил отказанное спасение').toBe(UNSAVED);
  });
});
