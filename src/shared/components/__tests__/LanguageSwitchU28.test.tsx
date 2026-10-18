// U-28 (решение владельца 2026-10-18): переключатель языка на телефоне — один
// общий контрол на токенах, вид «сетка с инверсией» как в десктопной вкладке
// «Редактор» (`EditorTab.tsx:220-232`). Белый цвет мимо токенов в тёплой теме
// «notion» делал контрол невидимым.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { renderWithProviders } from '../../../test/utils/render';
import { LanguageSwitch } from '../LanguageSwitch';
import { AccountProfileSection } from '../../../features/settings/components/AccountProfileSection';
import { MeAccountSection } from '../../../app/pages/MeAccountSection';

let mockLayout: 'desktop' | 'mobile' = 'mobile';
vi.mock('../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: mockLayout, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isAuthenticated: true }) }));
vi.mock('../../../core/settings/SettingsContext', () => ({
  useSettings: () => ({ openSettings: vi.fn() }),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

const whiteClass = /(^|\s)(bg|border|text)-white\//;

describe('U-28: один контрол языка на токенах', () => {
  beforeEach(() => { cleanup(); mockLayout = 'mobile'; });

  it('сам контрол: сетка из двух кнопок, выбранная — инверсия чернил, без белого мимо токенов', () => {
    renderWithProviders(<LanguageSwitch />);
    const grid = screen.getByTestId('language-switch');
    expect(grid.className).toContain('grid');
    expect(grid.className).toContain('grid-cols-2');
    const ru = screen.getByRole('button', { name: /Русский/ });
    const en = screen.getByRole('button', { name: /English/ });
    // В словаре тема по умолчанию — русский.
    expect(ru.className).toContain('bg-text-main');
    expect(ru.className).toContain('text-surface-base');
    expect(ru).toHaveAttribute('aria-pressed', 'true');
    expect(en.className).toContain('border-border-subtle');
    expect(en).toHaveAttribute('aria-pressed', 'false');
    for (const b of [ru, en]) {
      expect(b.className, 'цель касания стала меньше 44 px').toContain('min-h-11');
      expect(whiteClass.test(b.className), `белый мимо токенов: ${b.className}`).toBe(false);
    }
  });

  it('в «Настройки → Аккаунт» на телефоне стоит этот контрол, и белого там нет', () => {
    renderWithProviders(<AccountProfileSection userId="u1" />);
    expect(screen.getByTestId('language-switch')).toBeTruthy();
    const whites = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="language-switch"] *'))
      .filter(el => whiteClass.test(el.className));
    expect(whites.map(el => el.className), 'в контроле языка остался белый класс').toEqual([]);
  });

  it('в «Профиле» на телефоне — тот же контрол, а не второй вид', () => {
    renderWithProviders(
      <MeAccountSection user={{ uid: 'u1', email: 'a@b.c' } as never} onSignOut={vi.fn()} onSignIn={vi.fn()} />,
    );
    expect(screen.getByTestId('language-switch')).toBeTruthy();
  });
});
