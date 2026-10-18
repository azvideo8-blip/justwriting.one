// MF-22 (SA-3, решение владельца «явно»): шаг «Облако» спрашивает двумя равными
// кнопками, как десктопный SyncConsentModal; заранее включённого переключателя
// нет, «Пропустить» нет. Предложение загрузки — только после «Включить облако».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FirstRunCloudStep } from '../FirstRunStepper';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string, n: number) => `${k}:${n}`, language: 'ru' }),
}));

const pos = { index: 3, total: 3 };

describe('MF-22: explicit cloud choice', () => {
  beforeEach(() => cleanup());

  it('«Только на этом устройстве» → onFinish(false, false)', () => {
    const onFinish = vi.fn();
    render(<FirstRunCloudStep position={pos} cloudCount={0} onFinish={onFinish} />);
    fireEvent.click(screen.getByRole('button', { name: 'first_run_cloud_local' }));
    expect(onFinish).toHaveBeenCalledWith(false, false);
  });

  it('«Включить облако» → onFinish(true, …); with cloud notes the restore offer comes only after it', () => {
    const onFinish = vi.fn();
    const { unmount } = render(<FirstRunCloudStep position={pos} cloudCount={0} onFinish={onFinish} />);
    fireEvent.click(screen.getByRole('button', { name: 'first_run_cloud_on' }));
    expect(onFinish).toHaveBeenCalledWith(true, false);
    unmount();

    const onFinish2 = vi.fn();
    render(<FirstRunCloudStep position={pos} cloudCount={59} onFinish={onFinish2} />);
    expect(screen.queryByRole('button', { name: /first_run_restore_switch/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'first_run_cloud_on' }));
    expect(onFinish2).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'first_run_restore_switch:59' }));
    expect(onFinish2).toHaveBeenCalledWith(true, true);
  });

  // U-31 (решение владельца 2026-10-18): «две равные кнопки» MF-22 отменены —
  // десктопный `SyncConsentModal` показывает primary + ghost, и телефон обязан
  // давать ту же иерархию главного действия. Ничего не выбрано заранее и
  // «Пропустить» нет — эти две проверки MF-22 остаются.
  it('no control on the step is pre-selected; the first choice is primary, no «Пропустить»', () => {
    const { container } = render(<FirstRunCloudStep position={pos} cloudCount={59} onFinish={vi.fn()} />);
    expect(container.querySelectorAll('[role="switch"], input[type="checkbox"], [aria-checked="true"], [aria-pressed="true"]')).toHaveLength(0);
    const on = screen.getByRole('button', { name: 'first_run_cloud_on' });
    const local = screen.getByRole('button', { name: 'first_run_cloud_local' });
    expect(on.className).not.toBe(local.className);
    expect(on.className).toContain('bg-text-main');
    expect(local.className).toContain('text-text-main/60');
    expect(on.className).toContain('min-h-11');
    expect(local.className).toContain('min-h-11');
    expect(screen.queryByRole('button', { name: 'first_run_skip' })).toBeNull();
  });
});
