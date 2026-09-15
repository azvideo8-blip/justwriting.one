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
  WritingSettingsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: () => [],
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
});
