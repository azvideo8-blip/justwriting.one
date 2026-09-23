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
    language: 'ru',
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

vi.mock('../../../lifeLog/hooks/useCorpusDf', () => ({
  buildCorpusDf: vi.fn().mockResolvedValue({ df: new Map(), N: 0 }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

describe('F-2: WritingFinishModal toast on too large note save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    // Click "Сохранить" in form step to go to mood step
    const saveButton = screen.getByText('common_save');
    fireEvent.click(saveButton);

    // Now in mood step, click a mood button (e.g. 😊)
    const moodButton = screen.getByText('😊');
    fireEvent.click(moodButton);

    const doneButton = screen.getByText('finish_done');
    fireEvent.click(doneButton);

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

    const saveButton = screen.getByText('common_save');
    fireEvent.click(saveButton);

    const moodButton = screen.getByText('😊');
    fireEvent.click(moodButton);

    const doneButton = screen.getByText('finish_done');
    fireEvent.click(doneButton);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith('save_local_device_only');
      expect(mockShowToast).not.toHaveBeenCalledWith('save_local_only_queued');
      expect(onCancel).toHaveBeenCalled();
    });
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
