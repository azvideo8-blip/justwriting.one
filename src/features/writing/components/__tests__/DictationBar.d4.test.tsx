// D-4: панель записи. Компонент презентационный, поэтому и проверяется то, что
// видно человеку: живые слова, волна вместо точки при сбое уровня, отключённые
// кнопки во время обработки и отсутствие анимации при prefers-reduced-motion.
//
// Мутация: убрать `disabled={processing}` → красный случай про обработку.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { DictationBar } from '../DictationBar';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));

const baseProps = {
  liveText: 'сегодня бегал утром',
  interimText: 'темп был',
  level: 0.4,
  levels: Array.from({ length: 32 }, (_, i) => (i % 8) / 8),
  levelFailed: false,
  phase: 'recording' as const,
  seconds: 12,
  aiNoticeRemaining: null,
  onStop: vi.fn(),
  onCancel: vi.fn(),
};

let reduce = false;
beforeEach(() => {
  reduce = false;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('reduced-motion') && reduce,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('D-4: DictationBar', () => {
  it('живые слова показаны, черновик — отдельным элементом', () => {
    const { container } = render(<DictationBar {...baseProps} />);
    const words = container.querySelector('[data-dictation-words]');
    expect(words?.textContent).toContain('сегодня бегал утром');
    expect(words?.textContent).toContain('темп был');
    expect(words?.getAttribute('aria-live')).toBe('polite');
  });

  it('строка про запрос к ИИ показывается только когда он тратится', () => {
    const without = render(<DictationBar {...baseProps} />);
    expect(without.container.querySelector('[data-dictation-ai-notice]')).toBeNull();
    without.unmount();

    const withAi = render(<DictationBar {...baseProps} aiNoticeRemaining={7} />);
    expect(withAi.container.querySelector('[data-dictation-ai-notice]')?.textContent).toContain('voice_ai_request_notice');
    withAi.unmount();
  });

  it('сбой уровня: точка вместо волны', () => {
    const { container } = render(<DictationBar {...baseProps} levelFailed />);
    expect(container.querySelector('[data-dictation-wave]')).toBeNull();
    expect(container.querySelector('[data-dictation-static]')).not.toBeNull();
  });

  it('обычная запись: волна из 32 полос', () => {
    const { container } = render(<DictationBar {...baseProps} />);
    const wave = container.querySelector('[data-dictation-wave]');
    expect(wave).not.toBeNull();
    expect(wave?.querySelectorAll('span')).toHaveLength(32);
  });

  it('обработка: спиннер, кнопки отключены', () => {
    const { container } = render(<DictationBar {...baseProps} phase="processing" />);
    expect(container.querySelector('[data-dictation-spinner]')).not.toBeNull();
    expect(container.querySelector('[data-dictation-wave]')).toBeNull();
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    buttons.forEach(b => expect(b.disabled).toBe(true));
  });

  it('prefers-reduced-motion: анимации волны нет', () => {
    reduce = true;
    const { container } = render(<DictationBar {...baseProps} />);
    expect(container.querySelector('[data-dictation-wave]')).toBeNull();
    expect(container.querySelector('[data-dictation-static]')).not.toBeNull();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
  });
});
