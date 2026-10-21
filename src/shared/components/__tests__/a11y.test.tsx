import { screen, act } from '@testing-library/react';
import { renderWithProviders } from '../../../test/utils/render';
import { ConfirmDialogRenderer, useDialogStore } from '../ConfirmDialog';
import { LoadingSpinner } from '../LoadingSpinner';
import { EmptyState } from '../EmptyState';
import { Toggle } from '../Toggle';
import { BookOpen } from 'lucide-react';

describe('ConfirmDialog a11y', () => {
  it('has role=dialog and aria-modal', () => {
    renderWithProviders(<ConfirmDialogRenderer />);
    act(() => { void useDialogStore.getState().openConfirm({ title: 'Удалить?', message: 'Нельзя отменить' }); });
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('focus stays inside the modal (focus trap)', () => {
    renderWithProviders(<ConfirmDialogRenderer />);
    act(() => { void useDialogStore.getState().openConfirm({ title: 'Удалить?', message: 'Нельзя отменить' }); });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
});

describe('LoadingSpinner a11y', () => {
  it('has role=status', () => {
    renderWithProviders(<LoadingSpinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has aria-label', () => {
    renderWithProviders(<LoadingSpinner label="Загружаем данные" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Загружаем данные');
  });
});

describe('EmptyState a11y', () => {
  it('action button has type=button', () => {
    renderWithProviders(
      <EmptyState
        icon={BookOpen}
        title="Пусто"
        action={{ label: 'Начать', onClick: () => {} }}
      />
    );
    expect(screen.getByRole('button', { name: 'Начать' })).toHaveAttribute('type', 'button');
  });
});

describe('Toggle a11y', () => {
  it('has role=switch and aria-label', () => {
    renderWithProviders(<Toggle checked={false} onChange={() => {}} ariaLabel="Zen mode" />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-label', 'Zen mode');
  });

  it('reflects checked state via aria-checked', () => {
    renderWithProviders(<Toggle checked={true} onChange={() => {}} ariaLabel="Zen mode" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
});
