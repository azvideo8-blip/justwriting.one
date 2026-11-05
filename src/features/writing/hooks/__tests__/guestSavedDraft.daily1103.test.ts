// Дейлик 03.11 Н-1 (сначала красный тест аудитора d34a): DY10-10 «сохранил заметку → быстро закрыл
// вкладку» — запрет устаревшей записи стоит только у писателя аккаунта.
// Гость идёт через useDraftManager, который зовёт useSyncUnloadSave без третьего
// аргумента (src/features/writing/hooks/useDraftManager.ts:125-128).
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/shared/constants/storageKeys';
import { useContentStore } from '@/features/writing/store/useContentStore';
import { useTimerStore } from '@/features/writing/store/useTimerStore';
import { useSessionMetaStore } from '@/features/writing/store/useSessionMetaStore';
import { useEncryptionStore } from '@/core/crypto/useEncryptionStore';
import { useDraftManager } from '@/features/writing/hooks/useDraftManager';
import { useDraftAutosave } from '@/features/writing/hooks/useDraftAutosave';
import { cleanupDraftsAfterSave } from '@/features/writing/utils/sessionActions';
import type { AppUser } from '@/core/auth/types';
import { bumpDraftGeneration } from '../../services/draftWriter';

vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'mobile' }) }));
vi.mock('@/core/auth/accountReload', () => ({
  onBeforeAccountReload: () => () => {},
  isAccountReloadPending: () => false,
}));
vi.mock('@/core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('@/core/data', () => ({
  DataProvider: {
    getDraft: async () => null,
    saveDraft: async () => null,
    updateDraft: async () => {},
    deleteDraft: async () => {},
  },
}));
vi.mock('@/core/services/SyncService', () => ({
  SyncService: { syncOne: vi.fn().mockResolvedValue('d34a-cloud'), addToQueue: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));

const GUEST = 'guest_d34a';
const UID = 'u_d34a';
const TEXT = 'MARKER_D34A_сказанный_текст_уже_сохранён_заметкой';

function draftData() {
  return {
    title: '',
    content: TEXT,
    pinnedThoughts: [] as string[],
    seconds: 4,
    wpm: 10,
    wordCount: 6,
    initialWordCount: 0,
    sessionStartTime: undefined,
    activeSessionId: null,
    status: 'writing' as const,
  };
}

const settle = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });

function closeTab() {
  act(() => { window.dispatchEvent(new Event('pagehide')); });
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  useContentStore.setState({ content: TEXT, title: '', wordCount: 6, tags: [], labelId: undefined, ownerUid: GUEST });
  useTimerStore.setState({ status: 'writing' });
  useSessionMetaStore.getState().resetSessionMetadata();
  useEncryptionStore.setState({ encryptionEnabled: {} });
});

describe('d34a: окно после «Сохранить» — закрытие вкладки не должно возвращать сохранённое черновиком', () => {
  it('КОНТРОЛЬ (аккаунт): вето поколения стоит — унаследованный ключ не пишется', async () => {
    const db = await (await import('@/core/storage/localDb')).getLocalDb(UID);
    if (db.objectStoreNames.contains('drafts')) await db.clear('drafts');
    useContentStore.setState({ ownerUid: UID });
    bumpDraftGeneration(UID);
    renderHook(() => useDraftAutosave({ uid: UID } as AppUser, draftData()));
    useSessionMetaStore.getState().setSavedDocumentId('d34a-doc');
    await act(async () => { await cleanupDraftsAfterSave(UID, false, null); });
    closeTab();
    await settle(50);
    expect(localStorage.getItem(`draft-${UID}`), 'аккаунту вето помогло').toBeNull();
  });

  it('КОНТРАКТ (гость): после подтверждённого сохранения гостевого черновика быть не должно', async () => {
    renderHook(() => useDraftManager(GUEST, draftData, { onSaveDraft: async () => {} }));
    // Порядок handleSave: метка сохранённой заметки → стирание черновика → сброс
    // сессии (его здесь нет: окно измеряется тем, что stores ещё полны).
    useSessionMetaStore.getState().setSavedDocumentId('d34a-guest-doc');
    await act(async () => { await cleanupDraftsAfterSave(GUEST, true, null); });
    expect(localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT), 'черновик стёрт сохранением').toBeNull();
    closeTab();
    await settle(50);
    const after = localStorage.getItem(STORAGE_KEYS.GUEST_DRAFT);
    expect(after, 'гостевой черновик вернулся после подтверждённого сохранения').toBeNull();
  });
});
