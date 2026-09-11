import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWritingActions } from '../useWritingActions';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import type { LifeLogDocument } from '../../types/lifeLog';

vi.mock('../useLifeLog', () => ({
  useLifeLog: () => ({ refresh: vi.fn() }),
}));

vi.mock('../useDocuments', () => ({
  useDocuments: () => ({ refresh: vi.fn() }),
}));

vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({ setLifeLogVisible: vi.fn() }),
}));

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));

describe('useWritingActions.handleContinueDocument (S-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useContentStore.setState({ content: '', title: '' });
    useTimerStore.setState({ status: 'idle' });
  });

  it('prompts cancel confirmation when timer is idle but unsaved text exists in store', async () => {
    useContentStore.setState({ content: 'unsaved text from paste or dictation' });
    useTimerStore.setState({ status: 'idle' });

    const setShowCancelConfirm = vi.fn();
    const mockSession = {
      isGuest: true,
      userId: 'guest_1',
      setStatus: vi.fn(),
      handleStart: vi.fn(),
    } as any;

    const { result } = renderHook(() =>
      useWritingActions({
        session: mockSession,
        flow: {
          setSetupMode: vi.fn(),
          setShowCancelConfirm,
        },
      })
    );

    const doc: LifeLogDocument = {
      localId: 'doc_1',
      title: 'Existing Note',
      totalWords: 10,
      totalDuration: 100,
      currentVersion: 1,
      sessionsCount: 1,
      firstSessionAt: Date.now(),
      lastSessionAt: Date.now(),
      tags: [],
      storage: { local: true, cloud: false },
    };

    await act(async () => {
      await result.current.handleContinueDocument(doc);
    });

    expect(setShowCancelConfirm).toHaveBeenCalledWith(true);
  });
});
