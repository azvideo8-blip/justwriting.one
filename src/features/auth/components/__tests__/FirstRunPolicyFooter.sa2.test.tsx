// SA-2: обязательная галочка стояла в конце прокрутки (на 360×640 — на 2,8 экрана
// ниже), а «Продолжить» молчала серой. Обе галочки и кнопка — в подвале; пока
// согласие не отмечено, под кнопкой строка, чего не хватает. Тексты согласия
// и запись согласия не тронуты (решение владельца 2026-10-15).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { FirstRunPolicyStep } from '../FirstRunStepper';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));

describe('SA-2: first-run step 1 footer', () => {
  beforeEach(() => cleanup());

  const renderStep = () => render(<FirstRunPolicyStep position={{ index: 0, total: 3 }} onNext={vi.fn().mockResolvedValue(undefined)} />);

  // Живой снимок 360×640 показал: обе галочки в подвале занимают 529 px из 640, тело — 30 px.
  // Поэтому в подвале только обязательная галочка и кнопка, длинное необязательное ИИ-согласие — в теле.
  it('the required checkbox and «Продолжить» live in the footer; the long optional AI box scrolls with the text', () => {
    renderStep();
    const footer = screen.getByTestId('first-run-policy-footer');
    const inFooter = within(footer).getAllByRole('checkbox');
    expect(inFooter).toHaveLength(1);
    expect(inFooter[0]).toHaveAccessibleName(/privacy_consent_required_label/);
    expect(within(footer).getByRole('button', { name: /^privacy_modal_continue/ })).toBeInTheDocument();
    const body = footer.previousElementSibling as HTMLElement;
    expect(body.className).toContain('overflow-y-auto');
    const inBody = within(body).getAllByRole('checkbox');
    expect(inBody).toHaveLength(1);
    expect(inBody[0]).toHaveAccessibleName(/privacy_consent_ai_label/);
    expect(within(body).getByRole('button', { name: 'first_run_policy_link' })).toBeInTheDocument();
  });

  it('the hint is visible while the required box is unchecked and describes the button', () => {
    renderStep();
    const hint = screen.getByTestId('first-run-consent-hint');
    expect(hint.textContent).toBe('first_run_consent_hint');
    expect(screen.getByRole('button', { name: /^privacy_modal_continue/ })).toHaveAttribute('aria-describedby', 'first-run-consent-hint');
    fireEvent.click(screen.getByRole('checkbox', { name: /privacy_consent_required_label/ }));
    expect(screen.queryByTestId('first-run-consent-hint')).toBeNull();
    expect(screen.getByRole('button', { name: /^privacy_modal_continue/ })).toBeEnabled();
  });

  it('the AI box stays optional and off by default', () => {
    renderStep();
    expect(screen.getByRole('checkbox', { name: /privacy_consent_ai_label/ })).not.toBeChecked();
  });

  it('the policy link still expands the full text in the body', () => {
    renderStep();
    expect(screen.queryByTestId('first-run-policy-full')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'first_run_policy_link' }));
    expect(screen.getByTestId('first-run-policy-full')).toBeInTheDocument();
  });
});
