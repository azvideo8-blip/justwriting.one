import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWritingActions } from '../useWritingActions';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import * as sessionActions from '../../utils/sessionActions';

vi.mock('../useLifeLog', () => ({
  useLifeLog: () => ({ refresh: vi.fn() }),
}));


vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({ setLifeLogVisible: vi.fn() }),
}));

vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn(async () => false) }) }));
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: {
    saveNew: vi.fn().mockResolvedValue({ localId: 'local_123' }),
    saveVersion: vi.fn().mockResolvedValue({ forked: false, cloudSynced: false, isTooLarge: true }),
  },
}));

describe('F-2: useWritingActions.saveWritingSession for too large documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useContentStore.setState({ content: '', wordCount: 0, wpm: 0 });
    useTimerStore.setState({ status: 'idle', seconds: 0, sessionStartSeconds: 0, accumulatedDuration: 0, totalPauseSeconds: 0 });
    useSessionMetaStore.setState({ savedDocumentId: null, sessionStartTime: Date.now() });
  });

  it('returns isTooLarge: true and does not pass docId to cleanupDraftsAfterSave when saving a new huge document', async () => {
    const cleanupSpy = vi.spyOn(sessionActions, 'cleanupDraftsAfterSave').mockResolvedValue({ cloudSynced: false });

    // 700,001 characters
    const hugeContent = 'a'.repeat(700_001);
    useContentStore.setState({ content: hugeContent, wordCount: 1, wpm: 10 });

    const mockSession = {
      isGuest: false,
      userId: 'user_registered',
      setStatus: vi.fn(),
      handleStart: vi.fn(),
    } as any;

    const { result } = renderHook(() =>
      useWritingActions({
        session: mockSession,
        flow: {
          setSetupMode: vi.fn(),
        },
      })
    );

    let saveResult: any;
    await act(async () => {
      saveResult = await result.current.handleSave({
        title: 'Huge Note',
        tags: [],
      });
    });

    expect(saveResult).toEqual({
      docId: 'local_123',
      cloudSynced: false,
      isTooLarge: true,
    });

    // cleanupDraftsAfterSave must be called with null as docIdToSync, so it does not queue to cloud!
    expect(cleanupSpy).toHaveBeenCalledWith('user_registered', false, null);
  });
});
