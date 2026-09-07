import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionContinue } from '../useSessionContinue';
import { useWritingActions } from '../useWritingActions';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { StorageService } from '../../../../core/services/StorageService';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { Session } from '../../../../types';
import { LifeLogDocument } from '../../types/lifeLog';

vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: {
    addLocalCopy: vi.fn(),
    saveVersion: vi.fn(),
    saveNew: vi.fn(),
  },
}));

vi.mock('../../../../core/services/LocalVersionService', () => ({
  LocalVersionService: {
    getLatestContent: vi.fn(),
    getVersions: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    getDocument: vi.fn(),
    getDocumentsByOwner: vi.fn().mockResolvedValue([]),
  },
}));

const mockShowToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
    language: 'ru',
  }),
}));

const mockSetLifeLogVisible = vi.fn();
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    setLifeLogVisible: mockSetLifeLogVisible,
  }),
}));

vi.mock('../useDocuments', () => ({
  useDocuments: () => ({
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../useLifeLog', () => ({
  useLifeLog: () => ({
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('SYNC-D2: Continuing cloud-only notes', () => {
  const userId = 'user_123';

  beforeEach(() => {
    vi.clearAllMocks();
    useContentStore.setState({
      content: '',
      title: '',
      initialWordCount: 0,
      wordCount: 0,
      wpm: 0,
    });
    useTimerStore.setState({
      status: 'idle',
      seconds: 0,
      accumulatedDuration: 0,
      wordGoal: 0,
      timerDuration: 0,
      sessionStartWords: 0,
    });
    useSessionMetaStore.setState({
      savedDocumentId: null,
    });
  });

  describe('useSessionContinue', () => {
    const mockSetSetupMode = vi.fn();
    const mockSetTags = vi.fn();

    it('downloads cloud-only note and populates store with text', async () => {
      vi.mocked(LocalDocumentService.getDocumentsByOwner).mockResolvedValueOnce([]);
      vi.mocked(StorageService.addLocalCopy).mockResolvedValueOnce('local_new_1');
      vi.mocked(LocalVersionService.getLatestContent).mockResolvedValueOnce('Hello from cloud');

      const { result } = renderHook(() =>
        useSessionContinue({
          setSetupMode: mockSetSetupMode,
          setTags: mockSetTags,
          userId,
        })
      );

      const cloudSession: Session = {
        id: 'cloud_doc_1',
        title: 'Morning Reflections',
        content: '',
        duration: 300,
        wordCount: 3,
        charCount: 16,
        wpm: 30,
        createdAt: 1000,
        _isLocal: false,
        _contentNotLoaded: true,
      } as any;

      await act(async () => {
        await result.current.continueSession(cloudSession);
      });

      expect(StorageService.addLocalCopy).toHaveBeenCalledWith(userId, 'cloud_doc_1');
      expect(LocalVersionService.getLatestContent).toHaveBeenCalledWith('local_new_1');
      expect(useContentStore.getState().content).toBe('Hello from cloud');
      expect(useContentStore.getState().title).toBe('Morning Reflections');
      expect(useSessionMetaStore.getState().savedDocumentId).toBe('local_new_1');
      expect(mockSetSetupMode).toHaveBeenCalledWith('selection');
    });

    it('refuses to open blank editor when addLocalCopy fails (e.g. offline or error)', async () => {
      vi.mocked(LocalDocumentService.getDocumentsByOwner).mockResolvedValueOnce([]);
      vi.mocked(StorageService.addLocalCopy).mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() =>
        useSessionContinue({
          setSetupMode: mockSetSetupMode,
          setTags: mockSetTags,
          userId,
        })
      );

      const cloudSession: Session = {
        id: 'cloud_doc_1',
        title: 'Morning Reflections',
        content: '',
        duration: 300,
        wordCount: 150,
        createdAt: 1000,
        _isLocal: false,
        _contentNotLoaded: true,
      } as any;

      await act(async () => {
        await result.current.continueSession(cloudSession);
      });

      expect(useContentStore.getState().content).toBe('');
      expect(useSessionMetaStore.getState().savedDocumentId).toBeNull();
      expect(mockSetSetupMode).not.toHaveBeenCalled();
    });

    it('dispatches open-vault-unlock when locked vault error occurs', async () => {
      vi.mocked(LocalDocumentService.getDocumentsByOwner).mockResolvedValueOnce([]);
      vi.mocked(StorageService.addLocalCopy).mockRejectedValueOnce(new Error('LOCKED: session key missing'));

      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      const { result } = renderHook(() =>
        useSessionContinue({
          setSetupMode: mockSetSetupMode,
          setTags: mockSetTags,
          userId,
        })
      );

      const cloudSession: Session = {
        id: 'cloud_doc_locked',
        title: 'Encrypted Note',
        content: '',
        wordCount: 100,
        createdAt: 1000,
        _isLocal: false,
      } as any;

      await act(async () => {
        await result.current.continueSession(cloudSession);
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'open-vault-unlock' })
      );
      expect(useSessionMetaStore.getState().savedDocumentId).toBeNull();
    });
  });

  describe('useWritingActions', () => {
    const mockSetSetupMode = vi.fn();
    const mockSetShowCancelConfirm = vi.fn();

    const mockSession = {
      isGuest: false,
      userId,
      status: 'idle' as const,
      setStatus: vi.fn(),
      handleStart: vi.fn(),
    } as any;

    it('handleContinueDocument downloads cloud-only note and loads into store', async () => {
      vi.mocked(StorageService.addLocalCopy).mockResolvedValueOnce('local_downloaded_2');
      vi.mocked(LocalVersionService.getLatestContent).mockResolvedValueOnce('Continued cloud text');

      const { result } = renderHook(() =>
        useWritingActions({
          session: mockSession,
          flow: {
            setSetupMode: mockSetSetupMode,
            setShowCancelConfirm: mockSetShowCancelConfirm,
          },
        })
      );

      const cloudDoc: LifeLogDocument = {
        cloudId: 'cloud_doc_2',
        title: 'Important Draft',
        totalWords: 3,
        totalDuration: 120,
        currentVersion: 1,
        sessionsCount: 1,
        firstSessionAt: 1000,
        lastSessionAt: 2000,
        tags: ['work'],
        storage: { local: false, cloud: true },
      };

      await act(async () => {
        await result.current.handleContinueDocument(cloudDoc);
      });

      expect(StorageService.addLocalCopy).toHaveBeenCalledWith(userId, 'cloud_doc_2');
      expect(LocalVersionService.getLatestContent).toHaveBeenCalledWith('local_downloaded_2');
      expect(useContentStore.getState().content).toBe('Continued cloud text');
      expect(useContentStore.getState().title).toBe('Important Draft');
      expect(useSessionMetaStore.getState().savedDocumentId).toBe('local_downloaded_2');
      expect(mockSetSetupMode).toHaveBeenCalledWith(null);
      expect(mockSetLifeLogVisible).toHaveBeenCalledWith(false);
    });

    it('handleContinueSessionOrDoc handles ArchiveSession with _contentNotLoaded', async () => {
      vi.mocked(StorageService.addLocalCopy).mockResolvedValueOnce('local_downloaded_3');
      vi.mocked(LocalVersionService.getLatestContent).mockResolvedValueOnce('Loaded text from cloud note');

      const { result } = renderHook(() =>
        useWritingActions({
          session: mockSession,
          flow: {
            setSetupMode: mockSetSetupMode,
            setShowCancelConfirm: mockSetShowCancelConfirm,
          },
        })
      );

      const archiveSession: Session & { _contentNotLoaded?: boolean; _isLocal?: boolean } = {
        id: 'cloud_doc_3',
        userId,
        title: 'Archived Cloud Note',
        content: '',
        wordCount: 5,
        duration: 60,
        charCount: 26,
        wpm: 25,
        createdAt: 1000,
        _isLocal: true, // Note: even if _isLocal was flagged, _contentNotLoaded takes precedence!
        _contentNotLoaded: true,
      };

      await act(async () => {
        await result.current.handleContinueSessionOrDoc(archiveSession);
      });

      expect(StorageService.addLocalCopy).toHaveBeenCalledWith(userId, 'cloud_doc_3');
      expect(useContentStore.getState().content).toBe('Loaded text from cloud note');
      expect(useSessionMetaStore.getState().savedDocumentId).toBe('local_downloaded_3');
    });

    it('refuses to open blank editor when cloud download throws LOCKED', async () => {
      vi.mocked(StorageService.addLocalCopy).mockRejectedValueOnce(new Error('LOCKED: vault is locked'));
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      const { result } = renderHook(() =>
        useWritingActions({
          session: mockSession,
          flow: {
            setSetupMode: mockSetSetupMode,
            setShowCancelConfirm: mockSetShowCancelConfirm,
          },
        })
      );

      const cloudDoc: LifeLogDocument = {
        cloudId: 'cloud_doc_locked',
        title: 'Secret Note',
        totalWords: 50,
        totalDuration: 120,
        currentVersion: 1,
        sessionsCount: 1,
        firstSessionAt: 1000,
        lastSessionAt: 2000,
        tags: [],
        storage: { local: false, cloud: true },
      };

      await act(async () => {
        await result.current.handleContinueDocument(cloudDoc);
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'open-vault-unlock' })
      );
      expect(mockShowToast).toHaveBeenCalledWith('archive_note_locked', 'error');
      // Store content must remain empty, setup mode not closed
      expect(useContentStore.getState().content).toBe('');
      expect(useSessionMetaStore.getState().savedDocumentId).toBeNull();
      expect(mockSetLifeLogVisible).not.toHaveBeenCalled();
    });

    it('refuses to open blank editor when downloaded text is empty but totalWords > 0', async () => {
      vi.mocked(StorageService.addLocalCopy).mockResolvedValueOnce('local_corrupt');
      vi.mocked(LocalVersionService.getLatestContent).mockResolvedValueOnce(''); // Empty text returned!

      const { result } = renderHook(() =>
        useWritingActions({
          session: mockSession,
          flow: {
            setSetupMode: mockSetSetupMode,
            setShowCancelConfirm: mockSetShowCancelConfirm,
          },
        })
      );

      const cloudDoc: LifeLogDocument = {
        cloudId: 'cloud_doc_corrupt',
        title: 'Non-empty Note',
        totalWords: 200,
        totalDuration: 120,
        currentVersion: 1,
        sessionsCount: 1,
        firstSessionAt: 1000,
        lastSessionAt: 2000,
        tags: [],
        storage: { local: false, cloud: true },
      };

      await act(async () => {
        await result.current.handleContinueDocument(cloudDoc);
      });

      expect(mockShowToast).toHaveBeenCalledWith('error_load_failed', 'error');
      expect(useContentStore.getState().content).toBe('');
      expect(useSessionMetaStore.getState().savedDocumentId).toBeNull();
      expect(mockSetLifeLogVisible).not.toHaveBeenCalled();
    });
  });
});
