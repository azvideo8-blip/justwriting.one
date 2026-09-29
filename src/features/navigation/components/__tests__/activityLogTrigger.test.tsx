import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { LanguageProvider } from '../../../../shared/i18n';
import { Sidebar } from '../Sidebar';
import { BottomNav } from '../BottomNav';
import { ActivityLogBadge } from '../../../../app/ActivityLogBadge';
import { useActivityLogStore, ActivityLogItem } from '../../../../shared/activity/useActivityLogStore';

vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({
    isGuest: false,
    user: { uid: 'u1' },
  }),
}));

vi.mock('../../../../app/useLoginModal', () => ({
  useLoginModal: () => ({
    openLoginModal: vi.fn(),
  }),
}));

vi.mock('../../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({
    status: 'synced',
    pendingCount: 0,
  }),
}));

vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: false,
    zenModeEnabled: false,
    dismissRightPanel: vi.fn(),
  }),
}));

describe('AG-BG-2: Activity Log Triggers (Sidebar & BottomNav)', () => {
  beforeEach(() => {
    useActivityLogStore.setState({
      entries: [],
      panelOpen: false,
    });
  });

  it('desktop sidebar trigger is visible at rest, clicks to open panel', () => {
    renderWithProviders(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar isAdmin={false} />
        <ActivityLogBadge />
      </MemoryRouter>
    );

    // Trigger is visible at rest with 'Журнал'
    const trigger = screen.getByRole('button', { name: /журнал активности/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent(/журнал/i);

    // Panel is initially closed
    expect(screen.queryByRole('dialog', { name: /журнал активности/i })).toBeNull();

    // Clicking trigger opens panel
    fireEvent.click(trigger);
    expect(useActivityLogStore.getState().panelOpen).toBe(true);
    expect(screen.getByRole('dialog', { name: /журнал активности/i })).toBeInTheDocument();
  });

  it('mobile bottom nav trigger is visible, clicks to open panel', () => {
    renderWithProviders(
      <MemoryRouter initialEntries={['/']}>
        <BottomNav isAdmin={false} />
        <ActivityLogBadge />
      </MemoryRouter>
    );

    const trigger = screen.getByRole('button', { name: /журнал активности/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent(/журнал/i);

    expect(screen.queryByRole('dialog', { name: /журнал активности/i })).toBeNull();

    fireEvent.click(trigger);
    expect(useActivityLogStore.getState().panelOpen).toBe(true);
    expect(screen.getByRole('dialog', { name: /журнал активности/i })).toBeInTheDocument();
  });

  it('derives visual state: shows error styling when newest entry is an error, changes to success/info', () => {
    const errorEntry: ActivityLogItem = {
      id: 'e-1',
      level: 'error',
      message: 'Sync error',
      time: Date.now(),
      count: 1,
    };

    useActivityLogStore.setState({
      entries: [errorEntry],
      panelOpen: false,
    });

    const { rerender } = renderWithProviders(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar isAdmin={false} />
      </MemoryRouter>
    );

    const trigger = screen.getByRole('button', { name: /журнал активности/i });
    expect(trigger).toHaveTextContent(/1 ошибка/i);
    expect(trigger.className).toContain('text-accent-danger');

    // Add a newer success entry
    const successEntry: ActivityLogItem = {
      id: 's-1',
      level: 'success',
      message: 'Saved to cloud',
      time: Date.now(),
      count: 1,
    };

    useActivityLogStore.setState({
      entries: [successEntry, errorEntry],
    });

    rerender(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/']}>
          <Sidebar isAdmin={false} />
        </MemoryRouter>
      </LanguageProvider>
    );

    const updatedTrigger = screen.getByRole('button', { name: /журнал активности/i });
    expect(updatedTrigger).toHaveTextContent(/активность/i);
    expect(updatedTrigger.className).toContain('text-accent-success');
  });

  // T-1b удалил `const location = useLocation()`, а код ниже продолжал читать
  // `location.pathname` — то есть глобальный window.location. Вкладка тогда
  // подсвечивается по адресу страницы, а не по маршруту роутера.
  it('BottomNav marks the tab of the router location, not of window.location', () => {
    renderWithProviders(
      <MemoryRouter initialEntries={['/archive']}>
        <BottomNav isAdmin={false} />
      </MemoryRouter>
    );
    const current = screen.getAllByRole('button').filter(b => b.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    // Активна вкладка архива (маршрут роутера), а не «Писать» (window.location = '/').
    expect(current[0]).toHaveTextContent(/заметки|notes/i);
  });
});
