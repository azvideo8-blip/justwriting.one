// MR-5 + ревью 0.9.39: переключатель языка в «Настройки → Аккаунт» нужен только
// мобильному макету (шестерёнка «Профиля» ведёт туда). На десктопе язык живёт в
// «Редакторе», и второй переключатель на /settings — изменение десктопа.
// Мутация: убрать условие `layoutMode === 'mobile'` → красный десктопный кейс.
// U-28 (решение владельца 2026-10-18): контрол стал общим `LanguageSwitch` с
// полными названиями («🇷🇺 Русский» / «🇺🇸 English») вместо «RU»/«EN» — поиск по имени
// переписан, деление «десктоп/телефон» осталось прежним.
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { AccountProfileSection } from '../AccountProfileSection';

let mockLayout: 'desktop' | 'mobile' = 'desktop';
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: mockLayout, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isAuthenticated: true }) }));

describe('AccountProfileSection: язык только в мобильном макете', () => {
  it('десктоп — переключателя RU/EN нет', () => {
    mockLayout = 'desktop';
    renderWithProviders(<AccountProfileSection userId="u1" />);
    expect(screen.queryByRole('button', { name: /English/ })).toBeNull();
  });

  it('мобильный макет — переключатель есть', () => {
    mockLayout = 'mobile';
    renderWithProviders(<AccountProfileSection userId="u1" />);
    expect(screen.getByRole('button', { name: /English/ })).toBeTruthy();
  });
});
