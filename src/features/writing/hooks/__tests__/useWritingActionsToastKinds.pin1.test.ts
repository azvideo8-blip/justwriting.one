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

// PIN-1 (дейлик 20.11, «держит, но не закреплено»): письмо — итоги useWritingActions названы своим типом.
// Каждый кейс зелёный на коде и красный на названной мутации:
//  1 LOCKED → error + событие открытия сейфа   — убрать ветку LOCKED в catch handleContinueDocument
//  2 офлайн → error «недоступно офлайн»         — убрать ветку !navigator.onLine
//  3 прочая ошибка → error «не удалось загрузить» — убрать else-тост
//  4 бросок в handleContinueSessionOrDoc → error — убрать showToast в catch
//  5 fork версии → warning «сохранено копией»   — убрать тост forked или сменить тип на success
//  6 бросок saveNew → handleSave отклоняется      — убрать `throw e` в catch handleSave
const noteDocPin = (extra: Partial<LifeLogDocument> = {}): LifeLogDocument => ({
  localId: 'doc_pin1',
  title: 'Заметка',
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

function renderPinActions() {
  const { result } = renderHook(() =>
    useWritingActions({
      session: { isGuest: true, userId: 'guest_pin1', setStatus: vi.fn(), handleStart: vi.fn(), handleCancel: vi.fn() } as never,
      flow: { setSetupMode: vi.fn() },
    })
  );
  return result;
}

describe('PIN-1: письмо — итоги useWritingActions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    useContentStore.setState({ content: '', title: '' });
    useTimerStore.setState({ status: 'idle' });
    useSessionMetaStore.getState().setSavedDocumentId(null);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  });

  it('1. LOCKED при открытии заметки — error и событие открытия сейфа', async () => {
    vi.spyOn(LocalVersionService, 'getLatestContent').mockRejectedValue(new Error('LOCKED: vault'));
    const opened = vi.fn();
    window.addEventListener('open-vault-unlock', opened);
    const result = renderPinActions();
    await act(async () => { await result.current.handleContinueDocument(noteDocPin()); });
    window.removeEventListener('open-vault-unlock', opened);
    expect(mockShowToast).toHaveBeenCalledWith('archive_note_locked', 'error');
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('2. офлайн при открытии заметки — error «недоступно офлайн»', async () => {
    vi.spyOn(LocalVersionService, 'getLatestContent').mockRejectedValue(new Error('network down'));
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });
    const result = renderPinActions();
    await act(async () => { await result.current.handleContinueDocument(noteDocPin()); });
    expect(mockShowToast).toHaveBeenCalledWith('offline_action_unavailable', 'error');
  });

  it('3. прочая ошибка при открытии — error «не удалось загрузить»', async () => {
    vi.spyOn(LocalVersionService, 'getLatestContent').mockRejectedValue(new Error('MARKER_PIN1_IDB'));
    const result = renderPinActions();
    await act(async () => { await result.current.handleContinueDocument(noteDocPin()); });
    expect(mockShowToast).toHaveBeenCalledWith('error_load_failed', 'error');
  });

  it('4. бросок в продолжении сессии из архива — error «не удалось продолжить»', async () => {
    useContentStore.setState({ content: 'несохранённый текст в редакторе' });
    confirm.mockRejectedValueOnce(new Error('MARKER_PIN1_CONFIRM'));
    const result = renderPinActions();
    await act(async () => { await result.current.handleContinueSessionOrDoc(noteDocPin()); });
    expect(mockShowToast).toHaveBeenCalledWith('error_continue_session', 'error');
  });

  it('КОНТРОЛЬ 1–4: заметка открылась — без тоста ошибки', async () => {
    vi.spyOn(LocalVersionService, 'getLatestContent').mockResolvedValue('несколько слов текста');
    vi.spyOn(LocalVersionService, 'hasVersion').mockResolvedValue(true);
    const result = renderPinActions();
    await act(async () => { await result.current.handleContinueDocument(noteDocPin()); });
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('5. версия ушла в копию (fork) — warning «сохранено копией», не success', async () => {
    useSessionMetaStore.getState().setSavedDocumentId('doc_pin1');
    useContentStore.setState({ content: 'новый текст для сохранения' });
    vi.spyOn(StorageService, 'saveVersion').mockResolvedValue({ cloudSynced: true, forked: true, forkTitle: 'Копия' } as never);
    const result = renderPinActions();
    await act(async () => { await result.current.handleSave({ title: 'Заметка', tags: [], labelId: undefined } as never); });
    expect(mockShowToast).toHaveBeenCalledWith('sync_version_saved_as_copy', 'warning');
  });

  it('КОНТРОЛЬ 5: без fork — тоста о копии нет', async () => {
    useSessionMetaStore.getState().setSavedDocumentId('doc_pin1');
    useContentStore.setState({ content: 'новый текст для сохранения' });
    vi.spyOn(StorageService, 'saveVersion').mockResolvedValue({ cloudSynced: true, forked: false } as never);
    const result = renderPinActions();
    await act(async () => { await result.current.handleSave({ title: 'Заметка', tags: [], labelId: undefined } as never); });
    expect(mockShowToast).not.toHaveBeenCalledWith('sync_version_saved_as_copy', expect.anything());
  });

  it('6. бросок saveNew — handleSave отклоняется (вызывающий покажет ошибку), текст не потерян', async () => {
    useContentStore.setState({ content: 'новый текст, который нельзя потерять' });
    vi.spyOn(StorageService, 'saveNew').mockRejectedValue(new Error('MARKER_PIN1_SAVE'));
    const result = renderPinActions();
    await act(async () => {
      await expect(result.current.handleSave({ title: 'Заметка', tags: [], labelId: undefined } as never)).rejects.toThrow('MARKER_PIN1_SAVE');
    });
    expect(useContentStore.getState().content).toBe('новый текст, который нельзя потерять');
  });
});
