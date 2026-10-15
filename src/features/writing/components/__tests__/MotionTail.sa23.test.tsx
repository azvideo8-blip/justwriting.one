// SA-23: хвост ревью движения (emil) — тост, GoalToast, Toggle, кнопка-галочка,
// размытие модалок на телефоне, ручки листов без перетаскивания, заливка
// удержания выхода из потока, статичная точка записи, словарь кривых.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MobileWriteToolbar } from '../MobileWriteToolbar';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
const dict = vi.hoisted(() => ({ isListening: false }));
vi.mock('../../hooks/useDictation', () => ({
  useDictation: () => ({ isListening: dict.isListening, phase: 'idle', toggle: vi.fn(), hasSupport: true, isVaultActive: false, aiNoticeRemaining: 30 }),
}));

const read = (p: string) => readFileSync(resolve(process.cwd(), 'src', p), 'utf8');

describe('SA-23: motion tail', () => {
  beforeEach(() => {
    cleanup();
    dict.isListening = false;
    useContentStore.setState({ wordCount: 5 });
    useTimerStore.setState({
      status: 'writing', sessionType: 'free', seconds: 10, timerDuration: 1800, wordGoal: 0,
      sessionStartWords: 0, sessionStartSeconds: 0,
    } as Partial<ReturnType<typeof useTimerStore.getState>>);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('toast: translateY instead of scale 0.9, 220 in / 150 out', () => {
    const src = read('shared/components/Toast.tsx');
    expect(src).not.toMatch(/scale: 0\.9/);
    // MQ-6: позиционный ключ `y` (строку `transform` Motion не гасит при reduced motion).
    expect(src).toContain('y: 12');
    expect(src).toMatch(/duration: 0\.22/);
    expect(src).toMatch(/duration: 0\.15/);
  });

  it('GoalToast 220/150 (как у Toast, MQ-15), Toggle track 200 ms with the knob, checkmark does not start from nothing', () => {
    expect(read('shared/components/GoalToast.tsx')).toMatch(/duration: 0\.22/);
    expect(read('shared/components/GoalToast.tsx')).not.toMatch(/duration: 0\.4/);
    expect(read('shared/components/Toggle.tsx')).toContain('duration-200');
    expect(read('shared/components/Toggle.tsx')).not.toContain('duration-300');
    const css = read('index.css');
    const frame = css.slice(css.indexOf('@keyframes celebrationCheckmark'));
    expect(frame.slice(0, 120)).toContain('scale(0.6)');
    expect(frame.slice(0, 120)).not.toContain('scale(0)');
  });

  it('phone modal backdrop: small blur, denser background; desktop keeps the big one', () => {
    const src = read('shared/components/ModalShell.tsx');
    expect(src).toContain('bg-surface-base/90 backdrop-blur-sm md:bg-surface-base/80 md:backdrop-blur-2xl');
  });

  it('motion tokens live in @theme under names that do not shadow Tailwind', () => {
    const css = read('index.css');
    expect(css).toMatch(/--ease-out-strong:\s*cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
    expect(css).toMatch(/--ease-drawer:\s*cubic-bezier\(0\.32, 0\.72, 0, 1\)/);
    expect(css).not.toMatch(/--ease-out:/);
  });

  it.each([
    'features/writing/components/MobileSessionSetupSheet.tsx',
    'features/archive/components/MobileArchiveSidebarSheet.tsx',
    'features/writing/components/MobileWriteToolbar.tsx',
    'features/ai/components/AIPanel.tsx',
  ])('%s has no grab handle that promises a drag', (file) => {
    expect(read(file)).not.toContain('w-12 h-1.5');
  });

  it('holding the toolbar in stream mode fills the badge over 3 s; letting go resets it', () => {
    vi.useFakeTimers();
    const { container } = render(<MobileWriteToolbar onStop={vi.fn()} streamMode onToggleStreamMode={vi.fn()} />);
    const root = container.querySelector('[data-write-toolbar]') as HTMLElement;
    const fill = screen.getByTestId('stream-hold-fill');
    expect(fill.style.transform).toBe('scaleX(0)');
    act(() => { fireEvent.touchStart(root); });
    expect(fill.style.transform).toBe('scaleX(1)');
    expect(fill.style.transition).toContain('3000ms');
    act(() => { fireEvent.touchEnd(root); });
    expect(fill.style.transform).toBe('scaleX(0)');
  });

  it('recording is a static dot, not a pulse', () => {
    dict.isListening = true;
    const { container } = render(<MobileWriteToolbar onStop={vi.fn()} />);
    expect(container.innerHTML).not.toContain('animate-pulse');
    expect(container.querySelector('.bg-accent-danger[aria-hidden="true"]')).not.toBeNull();
  });

  it('first-run steps change with a 16 px shift and a fade (O1)', () => {
    const src = read('features/auth/components/FirstRunStepper.tsx');
    expect(src).toContain("mode=\"wait\"");
    expect(src).toContain('x: 16');
    expect(src).toContain('x: -16');
    expect(src.match(/<FirstRunStepper stepKey=/g)).toHaveLength(3);
  });
});
