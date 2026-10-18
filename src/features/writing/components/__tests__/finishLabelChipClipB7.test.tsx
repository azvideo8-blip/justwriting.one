// B-7: на десктопе выбранный чип метки в «Записано.» — `scale-105 shadow-lg`.
// После D-12 (`95bcfca8`) тело окна прокручивается само, и его край резал тень
// чипа; увеличенный чип выходил за контентную ширину — появлялся горизонтальный
// сдвиг без полосы прокрутки (`no-scrollbar`). Лечение — внутренний отступ тела
// с ответным отрицательным полем: край прокрутки уезжает наружу, вёрстка тела
// остаётся на месте. Тот же приём, что в 0.10.1 для «×» вложения (U-32).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { WritingFinishModal } from '../WritingFinishModal';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';

const SELECTED_LABEL_ID = 'label-work';
const SELECTED_LABEL_NAME = 'Работа';
const CHIP_SCALE = 'scale-105';
const CHIP_SHADOW = 'shadow-lg';

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
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
      div: ({ children, className, onClick, ...props }: any) => <div className={className} onClick={onClick} {...props}>{children}</div>,
      button: ({ children, className, onClick, ...props }: any) => <button className={className} onClick={onClick} {...props}>{children}</button>,
    },
    useReducedMotion: () => true,
  };
});

vi.mock('../WpmChart', () => ({ WpmChart: () => <div data-testid="wpm-chart" /> }));
vi.mock('../../../lifeLog/hooks/useCorpusDf', () => ({ buildCorpusDf: vi.fn().mockResolvedValue({ df: new Map(), N: 0 }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

/** Чип выбранной метки — он и растёт, и отбрасывает тень. */
function selectedChip(): HTMLElement {
  const chip = Array.from(document.querySelectorAll('button'))
    .find(btn => btn.className.includes(CHIP_SCALE));
  expect(chip, 'чипа выбранной метки нет').toBeTruthy();
  return chip as HTMLElement;
}

/** Ближайший предок-прокрутка — это и есть тело окна. */
function chipScroller(chip: HTMLElement): HTMLElement {
  const body = chip.closest('div[class*="overflow-y-auto"]');
  expect(body, 'чип не внутри прокручиваемого тела').not.toBeNull();
  return body as HTMLElement;
}

function renderFinishModal() {
  return render(
    <WritingFinishModal
      isOpen
      labels={[{ id: SELECTED_LABEL_ID, name: SELECTED_LABEL_NAME, color: '#7D4FD1' }]}
      labelId={SELECTED_LABEL_ID}
      setLabelId={vi.fn()}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

describe('B-7: тень выбранного чипа метки не режется краем прокрутки', () => {
  beforeEach(() => {
    cleanup();
    useContentStore.setState({ content: 'Test content', wordCount: 10, initialWordCount: 0, wpm: 20 });
    useTimerStore.setState({
      seconds: 60, sessionStartSeconds: 0, accumulatedDuration: 60, totalPauseSeconds: 0,
      wordGoalReached: false, timeGoalReached: false, status: 'idle',
    });
    useSessionMetaStore.setState({ savedDocumentId: 'doc_1', sessionStartTime: Date.now() });
    document.body.innerHTML = '';
  });

  it('тело окна: внутренний отступ и ответное отрицательное поле той же величины', () => {
    renderFinishModal();
    const className = chipScroller(selectedChip()).className;
    const pad = /(?:^|\s)px-(\d+(?:\.\d+)?)(?!\S)/.exec(className)?.[1];
    const neg = /(?:^|\s)-mx-(\d+(?:\.\d+)?)(?!\S)/.exec(className)?.[1];
    expect(pad, 'телу не хватает внутреннего отступа — край прокрутки режет тень чипа').toBeTruthy();
    expect(neg, 'нет ответного отрицательного поля — отступ сдвинул бы вёрстку').toBeTruthy();
    expect(neg, 'отступ и поле не равны: вёрстка тела поехала бы').toBe(pad);
  });

  it('чип остался с признаком выбора — лечим обрезку, а не убираем тень', () => {
    renderFinishModal();
    const chip = selectedChip();
    expect(chip.className).toContain(CHIP_SHADOW);
    expect(chip.textContent).toContain(SELECTED_LABEL_NAME);
    // Как в D-12: строка действий принадлежит окну, а не прокручиваемому телу.
    expect(screen.getByText('common_save')).toBeTruthy();
  });
});
