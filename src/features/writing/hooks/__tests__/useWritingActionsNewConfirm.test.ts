import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWritingActions } from '../useWritingActions';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { resetAndClear } from '../../store/storeActions';
import { cleanupDraftsAfterSave } from '../../utils/sessionActions';

vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), saveVersion: vi.fn(), saveNew: vi.fn() },
}));
vi.mock('../../../../core/services/LocalVersionService', () => ({
  LocalVersionService: { getLatestContent: vi.fn(), getVersions: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { getDocument: vi.fn(), getDocumentsByOwner: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({ setLifeLogVisible: vi.fn() }),
}));
vi.mock('../useDocuments', () => ({ useDocuments: () => ({ refresh: vi.fn() }) }));
vi.mock('../useLifeLog', () => ({ useLifeLog: () => ({ refresh: vi.fn() }) }));
vi.mock('../../store/storeActions', () => ({
  resetAndClear: vi.fn(),
  resetSession: vi.fn(),
  loadDraftIntoStore: vi.fn(),
}));
vi.mock('../../utils/sessionActions', () => ({
  cleanupDraftsAfterSave: vi.fn().mockResolvedValue({ cloudSynced: false }),
  reportKeystrokeStats: vi.fn(),
}));

const session = {
  isGuest: false,
  userId: 'u1',
  setStatus: vi.fn(),
  handleStart: vi.fn(),
} as never;

// D-3: «Новая заметка» при статусе idle стирала текст и удаляла черновик без
// подтверждения — а на idle редактор непустой ровно в тех случаях, где терять
// больнее всего: продолженная заметка до первого нажатия клавиши и
// восстановленный черновик.
describe('useWritingActions.handleNew confirmation (D-3)', () => {
  const setShowCancelConfirm = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useTimerStore.setState({ status: 'idle' });
    useContentStore.setState({ content: '', wordCount: 0 });
  });

  function mount() {
    const { result } = renderHook(() =>
      useWritingActions({ session, flow: { setSetupMode: vi.fn(), setShowCancelConfirm } })
    );
    return result;
  }

  it('asks before clearing an idle editor that holds text', async () => {
    useContentStore.setState({ content: 'восстановленный черновик', wordCount: 8 });

    const result = mount();
    await act(async () => { await result.current.handleNew(); });

    expect(setShowCancelConfirm).toHaveBeenCalledWith(true);
    expect(resetAndClear).not.toHaveBeenCalled();
    expect(cleanupDraftsAfterSave).not.toHaveBeenCalled();
    expect(useContentStore.getState().content).toBe('восстановленный черновик');
  });

  it('asks while a session is running, as it always did', async () => {
    useContentStore.setState({ content: 'печатается сессия', wordCount: 3 });
    useTimerStore.setState({ status: 'writing' });

    const result = mount();
    await act(async () => { await result.current.handleNew(); });

    expect(setShowCancelConfirm).toHaveBeenCalledWith(true);
    expect(resetAndClear).not.toHaveBeenCalled();
  });

  it('clears straight away when the editor is empty', async () => {
    const result = mount();
    await act(async () => { await result.current.handleNew(); });

    expect(setShowCancelConfirm).not.toHaveBeenCalled();
    expect(resetAndClear).toHaveBeenCalled();
    expect(cleanupDraftsAfterSave).toHaveBeenCalledWith('u1', false, null);
  });
});
