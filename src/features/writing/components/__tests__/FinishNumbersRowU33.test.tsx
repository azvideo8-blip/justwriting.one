// U-33 (решение владельца 2026-10-18, Q-3): «Записано.» на телефоне показывает
// одну строку из трёх чисел — слов / время / слов в минуту — в стиле десктопной
// сетки (`FinishModalStats.tsx:146-170`): моно-капс подписи, mono-цифры.
// Серию по дням и четыре кнопки десктопа на телефон не переносим.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { WritingFinishModal } from '../WritingFinishModal';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
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

function renderSheet() {
  cleanup();
  layoutMode = 'mobile';
  useContentStore.setState({ content: 'Глина сохнет быстрее, чем кажется.', wordCount: 15, wpm: 45, wpmHistory: [] });
  useTimerStore.setState({
    status: 'paused', sessionType: 'free', seconds: 120, wordGoal: 0,
    wordGoalReached: false, timeGoalReached: false,
    sessionStartWords: 0, sessionStartSeconds: 0,
  } as Partial<ReturnType<typeof useTimerStore.getState>>);
  return render(
    <WritingFinishModal
      isOpen
      onCancel={vi.fn()}
      onSave={vi.fn().mockResolvedValue({ docId: 'd1', cloudSynced: true, isTooLarge: false })}
      tags={[]}
      setTags={vi.fn()}
    />,
  );
}

describe('U-33: одна строка из трёх чисел', () => {
  beforeEach(() => { cleanup(); });

  it('числа слов, времени и слов в минуту — одной строкой, подписи моно-капсом', async () => {
    renderSheet();
    // Лист рендерится порталом, поэтому ищем по всему документу.
    const row = document.querySelector('[data-finish-numbers]') as HTMLElement;
    expect(row, 'строки из трёх чисел нет').toBeTruthy();
    const cells = Array.from(row.children);
    expect(cells).toHaveLength(3);
    expect(row.textContent).toContain('writing_words');
    expect(row.textContent).toContain('writing_time');
    expect(row.textContent).toContain('writing_wpm');
    // Числа доходят по счётчику `useCountUp` (800 мс на rAF) — ждём финальных значений.
    await waitFor(() => expect(row.textContent).toContain('2:00'), { timeout: 2500 });
    expect(row.textContent).toContain('15');
    // Подписи — общий моноширинный капс (U-9), числа — mono `tabular-nums`.
    for (const cell of cells) {
      const label = cell.firstElementChild as HTMLElement;
      expect(label.className).toContain('font-mono');
      expect(label.className).toContain('uppercase');
      const value = label.nextElementSibling as HTMLElement;
      expect(value.className).toContain('font-mono');
      expect(value.className).toContain('tabular-nums');
    }
    // Тихая строка «15 слов · 2 минуты · ~1 мин чтения» заменена числами.
    expect(row.nextElementSibling?.textContent ?? '').not.toContain('reading_time');
  });

  it('серию по дням и четыре кнопки десктопа на телефон не перенесли', () => {
    renderSheet();
    expect(screen.queryByText('finish_streak_zero'), 'на телефоне появилась серия').toBeNull();
    expect(screen.queryByText('finish_back'), 'на телефоне появился десктопный ряд кнопок').toBeNull();
  });
});
