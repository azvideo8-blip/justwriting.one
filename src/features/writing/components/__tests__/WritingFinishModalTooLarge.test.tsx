import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { WritingFinishModal } from '../WritingFinishModal';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';

const mockShowToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
    tp: (k: string) => k,
    language: 'ru',
  }),
}));

// DC-W2: тело окна читает настройку «Писать без цифр».
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    quietStats: false,
    setQuietStats: vi.fn(),
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    AnimatePresence: ({ children }: any) => <>{children}</>,
    motion: {
      div: ({ children, className, onClick, ...props }: any) => (
        <div className={className} onClick={onClick} {...props}>{children}</div>
      ),
      button: ({ children, className, onClick, ...props }: any) => (
        <button className={className} onClick={onClick} {...props}>{children}</button>
      ),
    },
    useReducedMotion: () => true,
  };
});

vi.mock('../WpmChart', () => ({
  WpmChart: () => <div data-testid="wpm-chart" />,
}));

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

vi.mock('../../../lifeLog/hooks/useCorpusDf', () => ({
  buildCorpusDf: vi.fn().mockResolvedValue({ df: new Map(), N: 0 }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// 0.11.22: вошедший человек с включённым синком — облако не приняло, задача в очереди.
const authUser = vi.hoisted(() => ({ current: null as { uid: string } | null }));
vi.mock('../../../../core/auth', async (orig) => ({ ...(await orig<object>()), getCurrentUser: () => authUser.current }));
vi.mock('../../../../core/sync/cloudSyncEnabled', async (orig) => ({ ...(await orig<object>()), cloudSyncEnabled: () => true }));

describe('F-2: WritingFinishModal toast on too large note save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser.current = null;
    useContentStore.setState({ content: 'Test content', wordCount: 10, initialWordCount: 0, wpm: 20 });
    useTimerStore.setState({
      seconds: 60,
      sessionStartSeconds: 0,
      accumulatedDuration: 60,
      totalPauseSeconds: 0,
      wordGoalReached: false,
      timeGoalReached: false,
      status: 'idle',
    });
    useSessionMetaStore.setState({ savedDocumentId: 'doc_1', sessionStartTime: Date.now() });
  });

  it('shows save_too_large_cloud_warning toast when onSave reports isTooLarge: true', async () => {
    const onSave = vi.fn().mockResolvedValue({
      docId: 'doc_1',
      cloudSynced: false,
      isTooLarge: true,
    });
    const onCancel = vi.fn();

    render(
      <WritingFinishModal
        isOpen={true}
        onCancel={onCancel}
        onSave={onSave}
      />
    );

    // Click "Сохранить" — DC-W3: окно сохраняется сразу, второго шага нет.
    fireEvent.click(screen.getByText('common_save'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith('save_too_large_cloud_warning', 'warning');
      expect(onCancel).toHaveBeenCalled();
    });
  });

  it('shows save_local_device_only toast for guest users instead of queued toast (D-12)', async () => {
    const onSave = vi.fn().mockResolvedValue({
      docId: 'doc_2',
      cloudSynced: false,
      isTooLarge: false,
    });
    const onCancel = vi.fn();

    render(
      <WritingFinishModal
        isOpen={true}
        onCancel={onCancel}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByText('common_save'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
      // У гостя облака нет — «сохранено на устройстве» и есть успех.
      expect(mockShowToast).toHaveBeenCalledWith('save_local_device_only', 'success');
      expect(mockShowToast).not.toHaveBeenCalledWith('save_local_only_queued');
      expect(onCancel).toHaveBeenCalled();
    });
  });

  // 0.11.22: «в облако отправится позже» шло зелёным успехом (тост без типа), хотя
  // заметки в облаке нет. Мутация: warningType всегда 'success' — красный.
  it('облако не приняло у вошедшего — предупреждение «отправится позже», не успех', async () => {
    authUser.current = { uid: 'u_real' };
    const onSave = vi.fn().mockResolvedValue({ docId: 'doc_q', cloudSynced: false, isTooLarge: false });
    render(<WritingFinishModal isOpen={true} onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByText('common_save'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('save_local_only_queued', 'warning'));
    expect(mockShowToast).not.toHaveBeenCalledWith('save_success', 'success');
  });

  // PIN-1 (2026-11-21): бросок сохранения назван. Мутация: убрать
  // errorMessage у runMutation в WritingFinishModal — красный.
  it('PIN-1: onSave бросил — error-тост error_save_failed, не успех и не тишина', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('SYNTHETIC_SAVE_THROW'));
    const onCancel = vi.fn();
    render(<WritingFinishModal isOpen={true} onCancel={onCancel} onSave={onSave} />);
    fireEvent.click(screen.getByText('common_save'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('error_save_failed', 'error'));
    expect(mockShowToast).not.toHaveBeenCalledWith('save_success', 'success');
    expect(onCancel).not.toHaveBeenCalled();
  });

  // DC-W3: настроение — необязательная строка в том же шаге, «Сохранить» отдаёт
  // его вместе с заметкой и делает это ровно один раз.
  it('saves once with the selected mood and renders no second mood step', async () => {
    const onSave = vi.fn().mockResolvedValue({ docId: 'doc_3', cloudSynced: true, isTooLarge: false });
    render(<WritingFinishModal isOpen={true} onCancel={vi.fn()} onSave={onSave} />);

    expect(screen.queryByText('finish_done')).toBeNull();
    expect(screen.queryByText('finish_skip_save')).toBeNull();
    // DC-W3: в строке настроения вместо 🤢 теперь 😖.
    expect(screen.getByRole('button', { name: 'mood_disgust' })).toHaveTextContent('😖');
    expect(screen.queryByText('🤢')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'mood_happy' }));
    fireEvent.click(screen.getByText('common_save'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ mood: '😊' }));
    });
  });

  it('repeats a mood tap to clear it and offers «Сохраню позже» without saving', () => {
    const onSave = vi.fn();
    const onSkipSave = vi.fn();
    render(<WritingFinishModal isOpen={true} onCancel={vi.fn()} onSave={onSave} onSkipSave={onSkipSave} />);

    const happy = screen.getByRole('button', { name: 'mood_happy' });
    fireEvent.click(happy);
    expect(happy).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(happy);
    expect(happy).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByText('finish_save_later'));
    expect(onSkipSave).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  // EA-9: закрытое окно не монтирует тело (оно было подписано на текст и таймер
  // и крутило анимацию цифр на каждой секунде), но черновик заголовка, как и
  // раньше, переживает «Отмену» и повторное открытие.
  it('renders nothing while closed and keeps the typed title across close and reopen', () => {
    const props = { onCancel: vi.fn(), onSave: vi.fn() };
    const { rerender, container } = render(<WritingFinishModal isOpen={true} {...props} />);
    fireEvent.change(screen.getByPlaceholderText('editor_title_placeholder'), { target: { value: 'Мой заголовок' } });

    rerender(<WritingFinishModal isOpen={false} {...props} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<WritingFinishModal isOpen={true} {...props} />);
    expect(screen.getByPlaceholderText('editor_title_placeholder')).toHaveValue('Мой заголовок');
  });
});
