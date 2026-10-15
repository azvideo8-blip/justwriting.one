// MF-10: на телефоне из /settings не было пути назад, кроме вкладок; кнопки
// RU/EN были ниже 44 px; между «Язык» и «Выйти» стояли две линии.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { AccountProfileSection } from '../AccountProfileSection';
import { SettingsBackRow } from '../SettingsBackRow';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'mobile', setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isAuthenticated: true }) }));

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

describe('MF-10: mobile settings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a back control leads to the profile when /settings is the first entry', () => {
    renderWithProviders(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsBackRow />} />
          <Route path="/me" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    const back = screen.getByRole('button', { name: /Профиль/ });
    expect(back.className).toContain('min-h-11');
    fireEvent.click(back);
    expect(screen.getByTestId('where').textContent).toBe('/me');
  });

  it('language buttons are at least 44 px', () => {
    renderWithProviders(<AccountProfileSection userId="u1" />);
    for (const name of ['RU', 'EN']) {
      const b = screen.getByRole('button', { name });
      expect(b.className).toContain('min-h-11');
      expect(b.className).toContain('min-w-11');
    }
  });

  it('one divider between «Язык» and «Выйти»: no bottom border followed by a top border', () => {
    const { container } = renderWithProviders(<AccountProfileSection userId="u1" />);
    const els = Array.from(container.querySelectorAll<HTMLElement>('*'));
    const doubled = els.filter((el, i) => {
      if (!/(^|\s)border-b(\s|$)/.test(el.className)) return false;
      const next = els.slice(i + 1).find(n => !el.contains(n));
      return !!next && /(^|\s)border-t(\s|$)/.test(next.className);
    });
    expect(doubled.map(el => el.className)).toEqual([]);
  });
});
