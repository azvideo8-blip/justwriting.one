// R7Q-014: след админских действий в админке — последние строки admin_actions.
// Требование тикета буквально: «только для чтения». Проверка не косметическая:
// если в этот лист кто-то приделает кнопку «удалить запись», исторический след
// перестанет быть следом.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { AdminActionsTable } from '../AdminActionsTable';
import type { AdminActionItem } from '../../../../core/services/AdminUserService';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

const rows: AdminActionItem[] = [
  { id: 7, at: '2026-10-16T09:00:00.000Z', adminUid: ADMIN, action: 'delete_user', targetUid: TARGET },
  { id: 6, at: '2026-10-15T18:30:00.000Z', adminUid: ADMIN, action: 'delete_user', targetUid: '33333333-3333-4333-8333-333333333333' },
];

describe('R7Q-014: AdminActionsTable', () => {
  it('показывает каждую строку: действие, кто и в отношении кого', () => {
    renderWithProviders(<AdminActionsTable actions={rows} />);
    const table = screen.getByTestId('admin-actions-table');
    expect(table).toBeInTheDocument();
    expect(screen.getAllByText('Удаление пользователя')).toHaveLength(2);
    expect(screen.getAllByText(ADMIN)).toHaveLength(2);
    expect(screen.getByText(TARGET)).toBeInTheDocument();
    expect(screen.getByText('33333333-3333-4333-8333-333333333333')).toBeInTheDocument();
  });

  it('в списке нет ни одной управляющей кнопки — только чтение', () => {
    renderWithProviders(<AdminActionsTable actions={rows} />);
    const table = screen.getByTestId('admin-actions-table');
    expect(table.querySelectorAll('button, input, select, textarea, a[href]')).toHaveLength(0);
    expect(table.tagName).toBe('TABLE');
  });

  it('неизвестное действие показывается как есть, а не пропадает', () => {
    renderWithProviders(<AdminActionsTable actions={[{ ...rows[0]!, action: 'reset_limit' }]} />);
    expect(screen.getByText('reset_limit')).toBeInTheDocument();
  });

  it('пустой след — сообщение, а не пустой квадрат', () => {
    renderWithProviders(<AdminActionsTable actions={[]} />);
    expect(screen.getByText('Записей нет')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-actions-table')).toBeNull();
  });

  it('нечитаемая отметка времени не роняет список, а показывается сырым значением', () => {
    renderWithProviders(<AdminActionsTable actions={[{ ...rows[0]!, at: 'не дата' }]} />);
    expect(screen.getByText('не дата')).toBeInTheDocument();
  });
});
