import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { AdminUsersTable } from '../AdminUsersTable';
import { AdminUserItem } from '../../../../types';

describe('AdminUsersTable', () => {
  const sampleUsers: AdminUserItem[] = [
    {
      uid: 'uid-1',
      email: 'invited@example.com',
      nickname: '',
      role: 'user',
      pending: true,
      noteCount: 0,
    },
    {
      uid: 'uid-2',
      email: 'active@example.com',
      nickname: 'Active Guy',
      role: 'admin',
      pending: false,
      noteCount: 12,
    },
    {
      uid: 'uid-3',
      email: 'inactive@example.com',
      nickname: '',
      role: 'user',
      pending: false,
      noteCount: 0,
    },
  ];

  it('renders user emails, roles, registration statuses and activity counts', () => {
    renderWithProviders(<AdminUsersTable users={sampleUsers} />);

    expect(screen.getByText('invited@example.com')).toBeInTheDocument();
    expect(screen.getByText('active@example.com')).toBeInTheDocument();
    expect(screen.getByText('inactive@example.com')).toBeInTheDocument();

    // Status badges: 1 invited, 2 registered
    expect(screen.getByText('Приглашён')).toBeInTheDocument();
    expect(screen.getAllByText('Зарегистрирован')).toHaveLength(2);

    // Activity badges: 1 active (12), 2 inactive (0)
    expect(screen.getByText(/Активен \(12\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/Неактивен \(0\)/)).toHaveLength(2);
  });

  it('triggers onSendPasswordReset callback when password reset button is clicked', () => {
    const handleSendPasswordReset = vi.fn();
    renderWithProviders(
      <AdminUsersTable
        users={sampleUsers}
        onSendPasswordReset={handleSendPasswordReset}
      />,
    );

    const resetButtons = screen.getAllByRole('button', { name: /Сброс пароля/i });
    expect(resetButtons.length).toBeGreaterThan(0);

    fireEvent.click(resetButtons[0]!);
    expect(handleSendPasswordReset).toHaveBeenCalledWith('invited@example.com');
  });

  it('triggers onResetLimit callback when AI limit reset button is clicked', () => {
    const handleResetLimit = vi.fn();
    renderWithProviders(
      <AdminUsersTable
        users={sampleUsers}
        onResetLimit={handleResetLimit}
      />,
    );

    const limitButtons = screen.getAllByRole('button', { name: /Сбросить/i });
    expect(limitButtons.length).toBeGreaterThan(0);

    fireEvent.click(limitButtons[1]!);
    expect(handleResetLimit).toHaveBeenCalledWith('uid-2', 'active@example.com');
  });

  it('offers «Удалить» for ordinary users only — not for admins and not for the current admin', () => {
    const onDeleteUser = vi.fn();
    renderWithProviders(<AdminUsersTable users={sampleUsers} onDeleteUser={onDeleteUser} currentUid="uid-3" />);
    const buttons = screen.getAllByRole('button', { name: /Удалить/ });
    // uid-1 — обычный пользователь; uid-2 — админ; uid-3 — сам смотрящий.
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(onDeleteUser).toHaveBeenCalledWith(expect.objectContaining({ uid: 'uid-1' }));
  });
});
