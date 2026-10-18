import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { Sidebar } from '../Sidebar';

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

let mockSyncStatus: any = {
  status: 'synced',
  pendingCount: 0,
  unsyncedCount: 0,
};

vi.mock('../../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => mockSyncStatus,
}));

vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: false,
    zenModeEnabled: false,
    dismissRightPanel: vi.fn(),
  }),
  WritingSettingsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

let mockEntries: any[] = [];
vi.mock('../../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: (selector: any) => selector({ entries: mockEntries, setPanelOpen: vi.fn() }),
}));

describe('Sidebar active navigation item styling (UI-03)', () => {
  it('renders active nav item as inverted pill and inactive with muted text', () => {
    renderWithProviders(
      <MemoryRouter initialEntries={['/archive']}>
        <Sidebar isAdmin={false} />
      </MemoryRouter>
    );

    const nav = screen.getByRole('navigation', { name: /навигация|navigation/i });
    const archiveButton = nav.querySelector('button[aria-current="page"]');
    expect(archiveButton).toBeTruthy();
    expect(archiveButton?.className).toContain('text-surface-base');
    expect(archiveButton?.className).not.toContain('text-brand-soft');
    expect(archiveButton?.className).not.toContain('border-brand-soft');

    // Indicator pill with bg-text-main
    const indicator = archiveButton?.querySelector('[aria-hidden="true"]');
    expect(indicator?.className).toContain('bg-text-main');
    expect(indicator?.className).toContain('rounded-xl');

    // Inactive button (e.g., nav_write) should have text-text-main/60
    const buttons = nav.querySelectorAll('nav button[tabindex="0"]');
    const inactiveButton = Array.from(buttons).find(btn => btn !== archiveButton);
    expect(inactiveButton).toBeTruthy();
    expect(inactiveButton?.className).toContain('text-text-main/60');
    expect(inactiveButton?.className).not.toContain('text-surface-base');
  });

  it('подпись вкладки ИИ берётся из словаря, а не из литерала (D-6)', () => {
    renderWithProviders(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar isAdmin={false} />
      </MemoryRouter>
    );

    const nav = screen.getByRole('navigation', { name: /навигация|navigation/i });
    const aiButton = Array.from(nav.querySelectorAll('button')).find(btn => /ИИ/.test(btn.textContent ?? ''));
    expect(aiButton, 'в подписи вкладки не «ИИ»').toBeTruthy();
  });

  it('illuminates activity log badge with warning style on warning entries (ERR-10)', () => {
    mockEntries = [
      { id: '1', level: 'warning', message: 'Rate limit or degradation warning', time: Date.now() },
    ];

    renderWithProviders(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar isAdmin={false} />
      </MemoryRouter>
    );

    const activityBtn = screen.getByRole('button', { name: /Журнал активности/i });
    expect(activityBtn).toBeInTheDocument();
    expect(activityBtn.className).toContain('text-accent-warning');
  });

  it('renders sync indicator with count for unsynced status (D-13)', () => {
    mockSyncStatus = {
      status: 'unsynced',
      pendingCount: 0,
      unsyncedCount: 5,
    };

    renderWithProviders(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar isAdmin={false} />
      </MemoryRouter>
    );

    const syncButton = screen.getByTitle('Не синхронизировано заметок: 5');
    expect(syncButton).toBeInTheDocument();
    expect(syncButton.textContent).toContain('Не синхронизировано заметок: 5');
    expect(syncButton.textContent).not.toContain('{count}');
  });
});
