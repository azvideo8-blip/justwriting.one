// MQ-11: окно «Разблокировать шифрование» на телефоне — лист (ModalShell sheet) поверх всего,
// поля ≥ 16 px, плейсхолдер `--text-muted` (≥ 4,5:1), «×», кнопка и ссылка — 44 px.
// Десктоп (md:) прежний: 14 px и карточка по центру.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { EncryptionPasswordModal } from '../EncryptionPasswordModal';
import { UnlockPrompt } from '../../../auth/components/UnlockPrompt';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u1' }, profile: null, refreshProfile: vi.fn() }),
}));
vi.mock('../../../../core/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../core/auth')>()),
  getCurrentUser: () => ({ uid: 'user-1', email: 'user@example.com' }),
  reauthenticate: vi.fn(),
}));
vi.mock('../../../../core/services/EncryptionService', () => ({
  initializeEncryption: vi.fn(), migrateNotesAfterSetup: vi.fn(), unlockVault: vi.fn(), recoverVaultWithCode: vi.fn(), changePassword: vi.fn(),
  VaultAlreadyExistsError: class extends Error {}, WrongPasswordError: class extends Error {}, WrongRecoveryCodeError: class extends Error {},
}));

const dialogClass = () => screen.getByRole('dialog').className;

describe('MQ-11: окно сейфа на телефоне', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('EncryptionPasswordModal: лист, а не центральная карточка', () => {
    render(<EncryptionPasswordModal mode="unlock" userId="u1" onDone={vi.fn()} onClose={vi.fn()} />);
    const cls = dialogClass();
    expect(cls).toContain('bg-surface-popup');
    expect(cls).not.toContain('max-w-[400px]');
    expect(cls).not.toContain('bg-surface-card');
    // Слой — critical: окно сейфа поверх остальных листов.
    expect(screen.getByRole('dialog').parentElement!.className).toContain('--z-critical');
    expect(screen.getByRole('dialog').parentElement!.className).toContain('items-end');
  });

  it('EncryptionPasswordModal: поле 16 px, плейсхолдер text-muted, «×» и кнопка 44 px', () => {
    render(<EncryptionPasswordModal mode="unlock" userId="u1" onDone={vi.fn()} onClose={vi.fn()} />);
    const field = screen.getByLabelText('unlock_title');
    expect(field.className).toMatch(/\btext-base\b/);
    expect(field.className).toContain('placeholder:text-text-muted');
    expect(field.className).not.toContain('text-main/40');
    expect(screen.getByRole('button', { name: 'close' }).className).toMatch(/\bh-11\b.*\bw-11\b/);
    expect(screen.getByRole('button', { name: /enc_unlock_submit/ }).className).toContain('min-h-11');
  });

  it('UnlockPrompt: лист, поле 16 px, плейсхолдер text-muted, кнопки 44 px', () => {
    render(<UnlockPrompt uid="u1" onUnlocked={vi.fn()} onClose={vi.fn()} />);
    expect(dialogClass()).toContain('bg-surface-popup');
    const field = screen.getByPlaceholderText('••••••••');
    expect(field.className).toMatch(/\btext-base\b/);
    expect(field.className).toContain('placeholder:text-text-muted');
    expect(screen.getByRole('button', { name: /unlock_submit/ }).className).toContain('min-h-11');
    expect(screen.getByRole('button', { name: 'common_cancel' }).className).toContain('min-h-11');
  });

  it('десктоп: центральная карточка, как раньше', () => {
    layoutMode = 'desktop';
    render(<EncryptionPasswordModal mode="unlock" userId="u1" onDone={vi.fn()} onClose={vi.fn()} />);
    expect(dialogClass()).toContain('max-w-[400px]');
    expect(dialogClass()).toContain('bg-surface-card');
  });
});
