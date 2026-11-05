import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionPersistence } from '../useSessionPersistence';
import { VAULT_UNLOCKED_EVENT } from '../../../../core/crypto/useEncryptionStore';
import { useContentStore } from '../../store/useContentStore';
import type { AppUser } from '../../../../core/auth/types';

vi.mock('../useDraftAutosave', () => ({
  useDraftAutosave: () => ({ saveStatus: 'idle', saveErrorKind: null, lastSavedAt: null }),
}));

vi.mock('../../../../shared/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

vi.mock('../../utils/draftUtils', () => ({
  applyDraftToStores: vi.fn(),
}));
// Шаг 6 DW-4: `resolve` и флаг «облако заперто» живут в мутаторе. Мокается
// только этот край — проверяется реакция хука на открытие сейфа.
const cloudLocked = vi.hoisted(() => ({ current: false }));
vi.mock('../../services/draftWriter', async (importActual) => ({
  ...(await importActual<typeof import('../../services/draftWriter')>()),
  resolve: vi.fn(),
  isCloudDraftLocked: () => cloudLocked.current,
}));
import { resolve } from '../../services/draftWriter';

describe('useSessionPersistence S-4 vault unlock draft reload', () => {
  const user: AppUser = {
    uid: 'vault_user_4',
    email: 'test@example.com',
    displayName: 'Test User',
    photoURL: null,
    metadata: { creationTime: null, lastSignInTime: null },
  };
  const mockActions = {
    setContent: vi.fn(),
    setTitle: vi.fn(),
    setPinnedThoughts: vi.fn(),
    setActiveSessionId: vi.fn(),
    setHasDraft: vi.fn(),
    setDraftInEditor: vi.fn(),
    resetAndClear: vi.fn(),
    resetSession: vi.fn(),
    setStatus: vi.fn(),
    setInitialWordCount: vi.fn(),
    setInitialDuration: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useContentStore.setState({ content: '', title: '' });
  });

  it('reloads cloud draft when VAULT_UNLOCKED_EVENT fires', async () => {
    // Initial mount: cloud draft is locked
    let callCount = 0;
    vi.mocked(resolve).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        cloudLocked.current = true;
        return null;
      }
      cloudLocked.current = false;
      return {
        userId: 'vault_user_4',
        title: 'Decrypted Title',
        content: 'Decrypted Content',
        seconds: 30,
        wpm: 20,
        wordCount: 2,
        updatedAt: Date.now(),
      };
    });

    renderHook(() =>
      useSessionPersistence(
        user,
        null,
        {
          title: '',
          content: '',
          pinnedThoughts: [],
          tags: [],
          sessionType: 'free',
          activeSessionId: null,
          initialDuration: 0,
          initialWordCount: 0,
          sessionStartTime: null,
        },
        {
          seconds: 0,
          wpm: 0,
          wordCount: 0,
          status: 'idle',
          timeGoalReached: false,
          wordGoalReached: false,
        },
        mockActions
      )
    );

    // Initial load ran
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(mockActions.setHasDraft).not.toHaveBeenCalledWith(true);

    // Vault unlocks!
    await act(async () => {
      window.dispatchEvent(new CustomEvent(VAULT_UNLOCKED_EVENT));
    });

    // Draft reloaded and applied
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(mockActions.setHasDraft).toHaveBeenCalledWith(true);
  });
});
