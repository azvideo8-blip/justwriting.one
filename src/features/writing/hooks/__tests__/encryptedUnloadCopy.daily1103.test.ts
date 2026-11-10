// Дейлик 03.11 Н-2 (красный тест аудитора d34c): сейф включён — хвост до отсрочки уходит локальной записью.
// закрытием вкладки, не теряются, даже если основная запись черновика не успела».
// У включённого сейфа ветка SEC-56 (src/features/writing/hooks/useDraftCore.ts:253-257)
// не пишет снимок в localStorage и вдобавок стирает старый — то есть страховки
// нет вообще, а человек про неё прочитал в журнале и в public/docs/writing.html.
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb } from '@/core/storage/localDb';
import { useContentStore } from '@/features/writing/store/useContentStore';
import { useTimerStore } from '@/features/writing/store/useTimerStore';
import { useSessionMetaStore } from '@/features/writing/store/useSessionMetaStore';
import { useEncryptionStore } from '@/core/crypto/useEncryptionStore';
import { useDraftAutosave } from '@/features/writing/hooks/useDraftAutosave';
import type { AppUser } from '@/core/auth/types';

vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'desktop' }) }));
vi.mock('@/core/auth/accountReload', () => ({
  onBeforeAccountReload: () => () => {},
  isAccountReloadPending: () => false,
}));
vi.mock('@/core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('@/core/data', () => ({
  DataProvider: { getDraft: async () => null, saveDraft: async () => null, updateDraft: async () => {}, deleteDraft: async () => {} },
}));
vi.mock('@/core/crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => true,
  maybeEncrypt: async (d: Record<string, unknown>) => d,
  maybeDecrypt: async (d: Record<string, unknown>) => d,
  isProfileLoaded: () => true,
}));

const UID = 'u_d34c';
const LAST_WORDS = 'MARKER_D34C_последние_слова_до_закрытия';
const draftData = {
  title: '',
  content: LAST_WORDS,
  pinnedThoughts: [] as string[],
  seconds: 3,
  wpm: 9,
  wordCount: 4,
  initialWordCount: 0,
  sessionStartTime: undefined,
  activeSessionId: null,
  status: 'writing' as const,
};

const settle = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  const db = await getLocalDb(UID);
  if (db.objectStoreNames.contains('drafts')) await db.clear('drafts');
  useContentStore.setState({ content: LAST_WORDS, title: '', wordCount: 4, tags: [], labelId: undefined});
  useTimerStore.setState({ status: 'writing' });
  useSessionMetaStore.getState().resetSessionMetadata();
  useEncryptionStore.setState({ encryptionEnabled: { [UID]: true } });
});

describe('d34c: последние слова не должны теряться ни у кого из людей', () => {
  it('сейф включён: вкладка закрыта до отсроченной записи — слова обязаны остаться', async () => {
    renderHook(() => useDraftAutosave({ uid: UID } as AppUser, draftData));
    // Отсрочку локальной записи НЕ дожидаемся: ровно то окно, о котором пишет журнал.
    localStorage.setItem(`draft-${UID}`, 'MARKER_D34C_снимок_прошлого_раунда');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await settle(30);

    const row = (await (await getLocalDb(UID)).get('drafts', UID)) as { content?: string } | undefined;
    const ls = localStorage.getItem(`draft-${UID}`);
    const saved = row?.content === LAST_WORDS || ls?.includes(LAST_WORDS);
    expect(saved, `текст не дошёл ни до строки черновика (${row ? row.content : 'нет строки'}), ни до снимка закрытия (${ls === null ? 'ключ стёрт' : ls})`).toBe(true);
  });

  it('ЗЕЛЁНЫЙ КОНТРОЛЬ: сейф выключён — тот же самый уход пишет снимок', async () => {
    useEncryptionStore.setState({ encryptionEnabled: { [UID]: false } });
    renderHook(() => useDraftAutosave({ uid: UID } as AppUser, draftData));
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await settle(30);
    const ls = localStorage.getItem(`draft-${UID}`);
    expect(ls, 'без сейфа снимок закрытия появляется').not.toBeNull();
    expect(ls).toContain(LAST_WORDS);
  });
});
