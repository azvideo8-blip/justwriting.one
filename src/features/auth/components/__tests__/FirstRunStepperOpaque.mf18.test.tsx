// MF-18 (SA-1): степпер первого входа должен закрывать экран письма. Фон шёл
// через несуществующую `var(--surface-base)` и был прозрачным; jsdom каскад
// не считает, поэтому проверяется сам токен-класс.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FirstRunFlow } from '../FirstRunStepper';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key, tp: (key: string) => key, language: 'ru' }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_mf18' }) }));
vi.mock('../../../../core/sync/useEmptyDeviceDetection', () => ({
  useEmptyDeviceDetection: () => ({ shouldPrompt: false, localCount: 0, cloudCount: 0, dismiss: vi.fn(), recheck: vi.fn() }),
}));

describe('MF-18: first-run stepper is opaque', () => {
  it('root uses the declared surface token, not var(--surface-base)', () => {
    render(
      <MemoryRouter>
        <FirstRunFlow uid="u_mf18" showPrivacy showConsent onPrivacyDone={vi.fn()} onConsentDone={vi.fn()} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    );
    const root = screen.getByTestId('first-run-stepper');
    expect(root.className).toContain('bg-surface-base');
    expect(root.className).not.toContain('--surface-base');
  });
});
