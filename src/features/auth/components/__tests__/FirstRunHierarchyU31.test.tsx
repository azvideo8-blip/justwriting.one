// U-31 (решение владельца 2026-10-18): первый запуск на телефоне — как
// десктопный `SyncConsentModal`: главная кнопка жирная (`font-bold`), выбор —
// первая `primary`, остальные `ghost`, второстепенный текст приглушён.
// Тексты согласий не тронуты: правка только цветов и кнопок.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { FirstRunCloudStep, FirstRunCodeStep, FirstRunPolicyStep } from '../FirstRunStepper';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string, n?: number) => (n === undefined ? k : `${k}:${n}`), language: 'ru' }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const pos = { index: 2, total: 3 };
const tokens = (el: HTMLElement) => el.className.split(/\s+/);

describe('U-31: первый запуск — иерархия как на десктопе', () => {
  beforeEach(() => { cleanup(); });

  it('шаг «Облако»: первый выбор primary, второй ghost, оба 44 px', () => {
    render(<FirstRunCloudStep position={pos} cloudCount={0} onFinish={vi.fn()} />);
    const on = screen.getByRole('button', { name: 'first_run_cloud_on' });
    const local = screen.getByRole('button', { name: 'first_run_cloud_local' });
    expect(tokens(on)).toContain('bg-text-main');
    expect(on.className).toContain('text-surface-base');
    expect(tokens(local)).not.toContain('bg-text-main');
    expect(local.className).toContain('text-text-main/60');
    for (const b of [on, local]) {
      expect(b.className).toContain('min-h-11');
      expect(b.className).toContain('w-full');
    }
  });

  it('предложение загрузки: «загрузить» primary, «позже» ghost', () => {
    render(<FirstRunCloudStep position={pos} cloudCount={59} onFinish={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'first_run_cloud_on' }));
    const restore = screen.getByRole('button', { name: 'first_run_restore_switch:59' });
    const later = screen.getByRole('button', { name: 'first_run_restore_later' });
    expect(tokens(restore)).toContain('bg-text-main');
    expect(tokens(later)).not.toContain('bg-text-main');
    expect(later.className).toContain('text-text-main/60');
  });

  it('главные кнопки шагов — `font-bold` и общий primary', () => {
    render(<FirstRunPolicyStep position={{ index: 0, total: 3 }} onNext={vi.fn().mockResolvedValue(undefined)} />);
    const cta = screen.getByRole('button', { name: /^privacy_modal_continue/ });
    expect(cta.className).toContain('font-bold');
    expect(tokens(cta)).toContain('bg-text-main');
    cleanup();

    render(<FirstRunCodeStep position={pos} code="CODE-WORD-777" onNext={vi.fn()} />);
    const cta2 = screen.getByRole('button', { name: /^privacy_modal_continue/ });
    expect(cta2.className).toContain('font-bold');
    expect(tokens(cta2)).toContain('bg-text-main');
  });

  it('второстепенный текст приглушён, кегль остался телефонный', () => {
    render(<FirstRunCloudStep position={pos} cloudCount={0} onFinish={vi.fn()} />);
    const body = screen.getByText('sync_consent_body');
    expect(body.className).toContain('text-text-main/60');
    expect(body.className).toContain('text-[15px]');
    cleanup();

    render(<FirstRunCodeStep position={pos} code="CODE-WORD-777" onNext={vi.fn()} />);
    const sub = screen.getByText('enc_recovery_code_subtitle');
    expect(sub.className).toContain('text-text-main/60');
  });
});
