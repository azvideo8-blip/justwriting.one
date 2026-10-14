// MC-3: на телефоне окно завершения — полноэкранный лист с одной мыслью, а не
// диалог с 23 контролами. Десктопный диалог не меняется.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WritingFinishModal } from '../WritingFinishModal';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

const mockShowToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
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
vi.mock('../WpmChart', () => ({ WpmChart: () => <div data-testid="wpm-chart" /> }));
vi.mock('../../../lifeLog/hooks/useCorpusDf', () => ({
  buildCorpusDf: vi.fn().mockResolvedValue({ df: new Map(), N: 0 }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

function renderModal(onSave = vi.fn().mockResolvedValue({ docId: 'doc_1', cloudSynced: true, isTooLarge: false })) {
  const onCancel = vi.fn();
  const view = render(<WritingFinishModal isOpen onCancel={onCancel} onSave={onSave} />);
  return { ...view, onCancel, onSave };
}

describe('MC-3: лист «Записано.» на телефоне', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    layoutMode = 'mobile';
    useContentStore.setState({ content: 'Глина сохнет быстро. Глазурь ложится ровно не с первого раза.', wordCount: 36, initialWordCount: 0, wpm: 40 });
    useTimerStore.setState({
      seconds: 40, sessionStartSeconds: 0, accumulatedDuration: 40, totalPauseSeconds: 0,
      wordGoalReached: false, timeGoalReached: false, status: 'idle',
    } as Partial<ReturnType<typeof useTimerStore.getState>>);
    useSessionMetaStore.setState({ savedDocumentId: 'doc_1', sessionStartTime: Date.now() });
  });

  it('заголовок — одно слово, статистики и стрика нет', () => {
    renderModal();
    expect(screen.getByText('finish_written_bare')).toBeInTheDocument();
    expect(screen.queryByText('finish_wpm_chart'), 'в листе осталась карточка скорости').toBeNull();
    expect(screen.queryByText('finish_streak_days'), 'в листе остался стрик').toBeNull();
    expect(screen.queryByTestId('wpm-chart'), 'в листе остался график').toBeNull();
    expect(screen.queryByText(/слов\/мин/)).toBeNull();
  });

  it('действий ровно четыре: «Сохранить», «Сохраню позже», «Обсудить с ИИ», «×»; контролов ≤ 14', () => {
    const { container } = renderModal();
    expect(screen.getByRole('button', { name: 'common_save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'finish_save_later' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish_discuss_ai/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'close' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'finish_back' }), 'кнопка «Вернуться к тексту» осталась рядом с «×»').toBeNull();
    const interactive = container.querySelectorAll('button, input, [role="button"]');
    expect(interactive.length, `контролов: ${interactive.length}`).toBeLessThanOrEqual(14);
  });

  it('«×» возвращает к тексту, «Сохранить» сохраняет', () => {
    const { onCancel, onSave } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'common_save' }));
    expect(onSave).toHaveBeenCalled();
  });

  it('листья — полноэкранный лист с тем же id заголовка', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe('finish-modal-title');
    expect(dialog.className).toContain('finish-sheet-full');
  });

  it('эхо первой фразы, название с подсказкой из текста, теги — строкой', () => {
    renderModal();
    expect(screen.getByText('Глина сохнет быстро.')).toBeInTheDocument();
    const title = screen.getByLabelText('finish_title_label');
    expect(title.getAttribute('placeholder')).toContain('Глина сохнет');
    expect(screen.getByText('finish_tags')).toBeInTheDocument();
    // Метка — только если метки у человека есть; у свежего аккаунта их нет.
    expect(screen.queryByText('finish_labels')).toBeNull();
  });
});

describe('MC-3: десктопный диалог не изменился', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    layoutMode = 'desktop';
    useContentStore.setState({ content: 'Глина сохнет быстро.', wordCount: 36, initialWordCount: 0, wpm: 40 });
    useTimerStore.setState({
      seconds: 40, sessionStartSeconds: 0, accumulatedDuration: 40, totalPauseSeconds: 0,
      wordGoalReached: false, timeGoalReached: false, status: 'idle',
    } as Partial<ReturnType<typeof useTimerStore.getState>>);
    useSessionMetaStore.setState({ savedDocumentId: 'doc_1', sessionStartTime: Date.now() });
  });

  it('заголовок со словами и временем, метрики и «Вернуться к тексту» на месте', () => {
    renderModal();
    expect(screen.getByText('finish_written_heading')).toBeInTheDocument();
    expect(screen.getByText('writing_wpm')).toBeInTheDocument();
    expect(screen.getByText('reading_time')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'finish_back' })).toBeInTheDocument();
    expect(screen.queryByText('finish_written_bare')).toBeNull();
  });
});
