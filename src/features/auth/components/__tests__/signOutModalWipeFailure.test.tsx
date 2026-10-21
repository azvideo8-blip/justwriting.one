// AUD-11 (доводка): провал очистки — не провал выхода. Окно закрывается, а не
// показывает человеку сырой код `LOCAL_WIPE_FAILED` и не оставляет его сидеть
// в диалоге после того, как выход уже состоялся. Объяснение уходит тостом на
// уровне вызывающего экрана.
// Фальсификация: убрать ветку LocalWipeFailedError в handleSignOut — окно
// перестаёт закрываться и печатает код, оба теста краснеют.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SignOutConfirmModal } from '../SignOutConfirmModal';
import { LanguageProvider } from '../../../../shared/i18n';

vi.mock('../../hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u_wipe_1' } }),
}));

vi.mock('../../services/localDataInventory', () => ({
  countLocalDataInventory: vi.fn().mockResolvedValue({
    notesCount: 3, unsyncedNotesCount: 0, versionsCount: 3, aiRecordsCount: 0,
  }),
}));

class LocalWipeFailedError extends Error {
  constructor() {
    super('LOCAL_WIPE_FAILED');
    this.name = 'LocalWipeFailedError';
  }
}

describe('AUD-11 sign-out modal after a failed local wipe', () => {
  beforeEach(() => vi.clearAllMocks());

  it('closes instead of showing the raw error code', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new LocalWipeFailedError());

    render(<LanguageProvider><SignOutConfirmModal open onClose={onClose} onConfirm={onConfirm} /></LanguageProvider>);
    fireEvent.click(screen.getByText('Выйти'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText('LOCAL_WIPE_FAILED')).toBeNull();
  });

  it('still shows an error in the dialog for a genuine sign-out failure', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new Error('network down'));

    render(<LanguageProvider><SignOutConfirmModal open onClose={onClose} onConfirm={onConfirm} /></LanguageProvider>);
    fireEvent.click(screen.getByText('Выйти'));

    expect(await screen.findByText('network down')).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ревью 0.10.7 (A-9b): окно рисуется карточкой, а не голым текстом поверх страницы', () => {
    render(<LanguageProvider><SignOutConfirmModal open onClose={vi.fn()} onConfirm={vi.fn()} /></LanguageProvider>);
    expect(screen.getByRole('dialog').className).toContain('bg-surface-card');
  });
});
