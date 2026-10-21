// MQ-15: хвост по движению (emil-review). Что сделано и проверяется:
//  W9/N-11 — лист выхода из потока через ModalShell (портал), не внутри панели с backdrop-blur;
//  N-10 — заливка удержания остаётся 3 с под reduced motion; N-12 — GoalToast как Toast;
//  R1, N-9, N-5, N-7, N-15 — по исходникам.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { MobileWriteToolbar } from '../MobileWriteToolbar';
import { GoalToast } from '../../../../shared/components/GoalToast';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';

let layoutMode: 'desktop' | 'mobile' = 'mobile';
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../hooks/useDictation', () => ({
  useDictation: () => ({ isListening: false, phase: 'idle', toggle: vi.fn(), hasSupport: true, isVaultActive: false, aiNoticeRemaining: 30 }),
}));

const src = (p: string) => readFileSync(p, 'utf8');

describe('MQ-15: лист выхода из потока (W9, N-11)', () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    layoutMode = 'mobile';
    useContentStore.setState({ wordCount: 10 });
    useTimerStore.setState({ status: 'writing', sessionType: 'free', seconds: 5, timerDuration: 0, wordGoal: 0, sessionStartWords: 0, sessionStartSeconds: 0 } as Partial<ReturnType<typeof useTimerStore.getState>>);
  });
  afterEach(() => vi.useRealTimers());

  it('удержание 3 с открывает лист порталом в body, а не внутри панели', () => {
    const { container } = render(<MobileWriteToolbar onStop={vi.fn()} streamMode onToggleStreamMode={vi.fn()} />);
    const toolbar = container.querySelector('[data-write-toolbar]')!;
    expect(screen.getByTestId('stream-hold-fill').getAttribute('data-holding')).toBe('false');
    fireEvent.touchStart(toolbar);
    expect(screen.getByTestId('stream-hold-fill').getAttribute('data-holding')).toBe('true');
    act(() => { vi.advanceTimersByTime(3000); });
    const dialog = screen.getByRole('dialog');
    expect(toolbar.contains(dialog), 'лист остался внутри панели с backdrop-filter').toBe(false);
    expect(dialog.parentElement!.parentElement).toBe(document.body);
  });

  it('заливка удержания под reduced motion не гасится глушителем', () => {
    const css = src('src/index.css');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\[data-testid="stream-hold-fill"\]\[data-holding="true"\] \{\s*transition-duration: 3000ms !important/);
  });
});

describe('MQ-15: GoalToast как Toast (N-12)', () => {
  beforeEach(() => cleanup());

  it('на телефоне — над нижней панелью с safe-area, текст переносится', () => {
    layoutMode = 'mobile';
    render(<GoalToast visible type="words" />);
    const status = screen.getByRole('status');
    expect(status.parentElement!.className).toContain('--bottom-nav-height');
    expect(status.textContent).toBe('goal_reached_words');
    expect(status.querySelector('span')!.className).not.toContain('whitespace-nowrap');
  });

  it('на десктопе — прежняя позиция', () => {
    layoutMode = 'desktop';
    render(<GoalToast visible type="time" />);
    expect(screen.getByRole('status').parentElement!.className).toContain('bottom-24');
  });
});

describe('MQ-15: по исходникам', () => {
  it('R1: читалка уходит вниз непрозрачной', () => {
    expect(src('src/features/archive/components/MobileNoteReader.tsx')).toMatch(/exit=\{\{ y: '100%' \}\}/);
  });
  it('N-9: шапка письма после дзена проступает с нуля', () => {
    const s = src('src/features/writing/components/MobileWriteScreen.tsx');
    expect(s).toContain('<AnimatePresence initial={false}>\n        {!showZen && (');
    expect(s).not.toContain('lighthouseActive');
  });
  it('N-5: ключевые кнопки откликаются на касание', () => {
    // B-8 (ревью 0.10.1): прежний подсчёт `<Button`-тегов по исходнику не ловил
    // снятие `press` ни с чипа режима, ни с микрофона — тест оставался зелёным.
    // Отклик панели письма теперь проверяется на рендере —
    // `PressTargetsRender.b8.test.tsx` (мутация «убрать press у 44 px кнопки» —
    // красный). Ниже остаётся то, что по существу проверяет разметку листа.
    expect(src('src/features/writing/components/MobileVoiceNoticeSheet.tsx').match(/className="press /g)).toHaveLength(2);
    // С 2026-10-18 (U-22) строка листа — общий `SHEET_ROW`; `active:bg-…` и
    // переход цвета лежат в нём, в файле листа «Ещё» литерала больше нет.
    expect(src('src/features/archive/components/MobileArchiveMenuSheet.tsx')).toContain('SHEET_ROW');
    // С 2026-10-18 (U-12) «×» панели — общий `IconButton`, а не самописная кнопка:
    // `press` лежит в его базовых классах, литерала в файле больше нет.
    expect(src('src/features/archive/components/MobileInlinePanel.tsx')).toContain('<IconButton');
  });
  it('N-7: панель архива проступает', () => {
    expect(src('src/features/archive/components/MobileInlinePanel.tsx')).toContain('initial={{ opacity: 0 }}');
  });
});
