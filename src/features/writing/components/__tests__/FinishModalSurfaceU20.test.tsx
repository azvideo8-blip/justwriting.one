// U-20 (решение владельца 2026-10-18): «Записано.» на телефоне — как на десктопе:
// ✨ у «Обсудить с ИИ» вместо стрелки, значок праздника по центру над заголовком,
// чипы тегов `rounded-lg`, один фон (тот, что даёт `ModalShell`, без второй подложки).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { WritingFinishModal } from '../WritingFinishModal';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';

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

function renderModal() {
  cleanup();
  layoutMode = 'mobile';
  useContentStore.setState({ content: 'Глина сохнет быстрее, чем кажется.', wordCount: 5, wpm: 20, wpmHistory: [] });
  useTimerStore.setState({
    status: 'paused', sessionType: 'words', seconds: 120, wordGoal: 5,
    wordGoalReached: true, timeGoalReached: false,
    sessionStartWords: 0, sessionStartSeconds: 0,
  } as Partial<ReturnType<typeof useTimerStore.getState>>);
  return render(
    <WritingFinishModal
      isOpen
      onCancel={vi.fn()}
      onSave={vi.fn().mockResolvedValue({ docId: 'd1', cloudSynced: true, isTooLarge: false })}
      tags={['глина']}
      setTags={vi.fn()}
    />,
  );
}

describe('U-20: «Записано.» на телефоне как на десктопе', () => {
  beforeEach(() => { cleanup(); });

  it('у «Обсудить с ИИ» значок вместо стрелки «→»', () => {
    renderModal();
    const discuss = screen.getByRole('button', { name: /finish_discuss_ai/ });
    expect(discuss.textContent, 'в подписи осталась стрелка').not.toContain('→');
    expect(discuss.querySelector('svg'), 'рядом с «Обсудить с ИИ» нет значка').toBeTruthy();
  });

  it('значок праздника по центру над заголовком, а не в углу рядом с «×»', () => {
    renderModal();
    const heading = screen.getByText('finish_written_bare');
    const badge = document.querySelector('.w-12') as HTMLElement;
    expect(badge, 'значка праздника нет').toBeTruthy();
    // Он идёт перед заголовком и не в шапке с «×».
    expect(badge.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const closeRow = screen.getByRole('button', { name: 'close' }).parentElement as HTMLElement;
    expect(closeRow.contains(badge), 'значок остался в углу рядом с «×»').toBe(false);
    // По центру — обёртка с `justify-center`.
    expect(badge.parentElement?.className).toContain('justify-center');
  });

  it('чипы тегов — `rounded-lg`, как на десктопной сетке тегов', () => {
    renderModal();
    const chip = screen.getByRole('button', { name: /#глина/ });
    expect(chip.className).toContain('rounded-lg');
    expect(chip.className).not.toContain('rounded-full');
  });

  it('у листа одна фоновая подложка: `bg-surface-card` на телефоне не накладывается', () => {
    renderModal();
    const sheet = document.querySelector('.finish-sheet-full') as HTMLElement;
    expect(sheet, 'лист «Записано.» не найден').toBeTruthy();
    expect(sheet.className).not.toContain('bg-surface-card');
  });
});
