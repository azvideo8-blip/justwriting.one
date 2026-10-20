import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDraftAutosave } from '../useDraftAutosave';
import { getLocalDb } from '../../../../core/storage/localDb';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { useEncryptionStore } from '../../../../core/crypto/useEncryptionStore';
import type { AppUser } from '../../../../core/auth/types';
import { WritingDraftService } from '../../services/WritingDraftService';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../../../core/auth/accountReload', () => ({
  onBeforeAccountReload: () => () => {},
  isAccountReloadPending: () => false,
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'mobile' }) }));

// AS-1: уход из редактора внутри приложения снимает таймер автосохранения и
// поднимает поколение черновика. Текст жил только в памяти стора, и закрытие
// вкладки с другой страницы его теряло. Тест идёт через настоящий persistDraft
// и IndexedDB; маркер выдуманный.

const user = { uid: 'as1_user' } as AppUser;
const draftData = {
  title: 'AS-1',
  content: 'ПОСЛЕДНИЙ-ТЕКСТ-AS1',
  pinnedThoughts: [],
  seconds: 3,
  wpm: 10,
  wordCount: 2,
  initialWordCount: 0,
  sessionStartTime: Date.now(),
  activeSessionId: null,
  status: 'writing' as const,
};

async function localDraftContent(): Promise<string | undefined> {
  const db = await getLocalDb(user.uid);
  return (await db.get('drafts', user.uid))?.content;
}

describe('AS-1: размонтирование редактора сохраняет последний текст локально', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    useContentStore.setState({
      content: draftData.content,
      title: draftData.title,
      wordCount: draftData.wordCount,
      ownerUid: user.uid,
    });
    useTimerStore.setState({ status: 'writing' });
    useSessionMetaStore.getState().resetSessionMetadata();
    useEncryptionStore.setState({ encryptionEnabled: {} });
    const db = await getLocalDb(user.uid);
    await db.clear('drafts');
  });

  it('без сейфа: уход раньше 1-секундного таймера пишет последний текст', async () => {
    const { unmount } = renderHook(() => useDraftAutosave(user, draftData));

    unmount();

    await waitFor(async () => {
      expect(await localDraftContent()).toBe(draftData.content);
    });
  });

  it('с сейфом: локальный черновик тоже пишется, открытый текст в localStorage не кладём', async () => {
    useEncryptionStore.setState({ encryptionEnabled: { [user.uid]: true } });
    const { unmount } = renderHook(() => useDraftAutosave(user, draftData));

    unmount();

    await waitFor(async () => {
      expect(await localDraftContent()).toBe(draftData.content);
    });
    expect(localStorage.getItem(`draft-${user.uid}`)).toBeNull();
  });

  // Приёмка ai-privacy (код-ревью, M-3): сохранение заметки поднимает поколение
  // черновика и стирает его ДО сброса сессии. Размонтирование в этом окне не
  // должно вернуть сохранённый текст «несохранённым черновиком». Мутация: писать
  // на размонтировании с текущим поколением — красный.
  it('после сохранения заметки (поколение поднято) размонтирование черновик не возвращает', async () => {
    const { unmount } = renderHook(() => useDraftAutosave(user, draftData));
    WritingDraftService.bumpDraftGeneration(user.uid);

    unmount();
    await new Promise(r => setTimeout(r, 50));

    expect(await localDraftContent()).toBeUndefined();
  });
});
