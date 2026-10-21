import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWritingActions } from '../useWritingActions';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { StorageService } from '../../../../core/services/StorageService';
import type { LifeLogDocument } from '../../types/lifeLog';

vi.mock('../useLifeLog', () => ({
  useLifeLog: () => ({ refresh: vi.fn() }),
}));


vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({ setLifeLogVisible: vi.fn() }),
}));

const mockShowToast = vi.fn();
const { confirm } = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm }) }));
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: (...a: unknown[]) => mockShowToast(...a) }),
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));

vi.mock('../../utils/sessionActions', () => ({
  cleanupDraftsAfterSave: vi.fn(async () => ({ cloudSynced: false })),
  reportKeystrokeStats: vi.fn(),
}));

/** Синтетический текст нужной длины: живых формулировок в тесте нет. */
const words = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ');

const noteDoc = (extra: Partial<LifeLogDocument> = {}): LifeLogDocument => ({
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
  ...extra,
});

function renderActions() {
  const { result } = renderHook(() =>
    useWritingActions({
      session: { isGuest: true, userId: 'guest_1', setStatus: vi.fn(), handleStart: vi.fn(), handleCancel: vi.fn() } as never,
      flow: { setSetupMode: vi.fn() },
    })
  );
  return { result };
}

describe('useWritingActions.handleContinueDocument (S-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useContentStore.setState({ content: '', title: '' });
    useTimerStore.setState({ status: 'idle' });
    useSessionMetaStore.getState().setSavedDocumentId(null);
  });

  it('prompts cancel confirmation when timer is idle but unsaved text exists in store', async () => {
    useContentStore.setState({ content: 'unsaved text from paste or dictation' });
    useTimerStore.setState({ status: 'idle' });

    const { result } = renderActions();

    await act(async () => {
      await result.current.handleContinueDocument(noteDoc());
    });

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'writing_cancel_confirm' }));
  });

  // R7Q-001: `total_words` в облаке — наивысшая отметка длины (0039, W-2), и забор
  // переносит её в локальную копию. По этой отметке раньше считалась отсечка хода:
  // заметку сократили с 350 слов до 120, человек дописал 40 — ход записал 0 слов,
  // живой счётчик стоял на нуле, а «цель достигнута» на такой заметке не загоралась.
  it('R7Q-001: отсечка хода считается по тексту заметки, а не по отметке длины', async () => {
    vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue(words(120, 'слово'));
    vi.spyOn(LocalVersionService, 'hasVersion').mockResolvedValue(true);
    const saved: Array<{ wordCount: number }> = [];
    vi.spyOn(StorageService, 'saveVersion').mockImplementation(async (_u, _id, data) => {
      saved.push(data as unknown as { wordCount: number });
      return { cloudSynced: false, forked: false } as never;
    });

    const { result } = renderActions();

    await act(async () => {
      await result.current.handleContinueDocument(noteDoc({ totalWords: 350 }));
    });

    expect(useContentStore.getState().initialWordCount).toBe(120);
    expect(useTimerStore.getState().sessionStartWords).toBe(120);
    expect(useContentStore.getState().wordCount).toBe(120);

    // 40 слов поверх загруженного текста — ход обязан дать ровно 40.
    await act(async () => {
      useContentStore.setState({ content: `${words(120, 'слово')} ${words(40, 'добор')}` });
      await result.current.handleSave({ title: 'Existing Note', tags: [], labelId: undefined } as never);
    });

    expect(saved).toHaveLength(1);
    expect(saved[0]?.wordCount).toBe(40);
  });

  // R7Q-002: тем же `totalWords` кормилась страховка «не открывать пустым
  // редактором заметку с текстом». Заметку, очищенную до нуля, нельзя было ни
  // открыть, ни дописать: «Не удалось загрузить», и входа нет.
  it('R7Q-002: заметку с очищенным до нуля текстом можно открыть', async () => {
    vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue('');
    vi.spyOn(LocalVersionService, 'hasVersion').mockResolvedValue(true);

    const { result } = renderActions();

    await act(async () => {
      await result.current.handleContinueDocument(noteDoc({ totalWords: 350 }));
    });

    expect(mockShowToast).not.toHaveBeenCalledWith('error_load_failed', 'error');
    expect(useContentStore.getState().content).toBe('');
    expect(useContentStore.getState().initialWordCount).toBe(0);
  });

  it('страховка на месте: локально текста нет, а заметка из облака — пустой редактор не открывается', async () => {
    vi.spyOn(StorageService, 'addLocalCopy').mockResolvedValue('local-from-cloud');
    vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue('');
    vi.spyOn(LocalVersionService, 'hasVersion').mockResolvedValue(false);

    const { result } = renderActions();

    await act(async () => {
      await result.current.handleContinueDocument(noteDoc({ localId: '', cloudId: 'cloud-1', totalWords: 350 }));
    });

    expect(mockShowToast).toHaveBeenCalledWith('error_load_failed', 'error');
    expect(useContentStore.getState().content).toBe('');
  });
});
