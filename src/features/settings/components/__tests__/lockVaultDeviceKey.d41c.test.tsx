// d41c (Н-3): «Запереть сейф» обещает, что автооткрытия на этом устройстве больше
// не будет. handleLockVault делает void clearDeviceKey(userId) и безусловно
// показывает info «Сейф заперт»: отказ IndexedDB (keyVaultCache.ts:72-86 бросает)
// остаётся необработанным, ключ устройства жив, useEncryptionSetup:40-110
// автооткроет сейф при перезагрузке. Тот же класс: FirstRunStepper:440-441,
// RecoveryCodeGate:58-60, AuthService.signOut:170-176. Настоящие
// AccountVaultSection + ToastProvider; моки только края (IDB-ключ, замок, профиль).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { createElement as h, type ReactNode } from 'react';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { ToastProvider } from '@/shared/components/Toast';

const clearDeviceKey = vi.hoisted(() => vi.fn());

vi.mock('@/core/crypto/keyVaultCache', () => ({ clearDeviceKey }));
vi.mock('@/core/services/EncryptionService', () => ({
  EncryptionService: { lockVault: vi.fn() },
  WrongPasswordError: class WrongPasswordError extends Error {},
  hasVault: () => true,
}));
vi.mock('@/core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: (cb: (s: { isVaultUnlocked: boolean }) => unknown) => cb({ isVaultUnlocked: true }),
  setRememberDevice: vi.fn(),
}));
vi.mock('@/core/crypto/encrypt', () => ({ getSessionKey: () => null }));
vi.mock('@/app/useAuthStatus', () => ({
  useAuthStatus: () => ({ profile: { encryptionMeta: { recoveryWrappedDataKey: 'x' } }, refreshProfile: vi.fn() }),
}));
vi.mock('@/core/auth', () => ({
  getCurrentUser: () => ({ uid: 'u-d41c' }),
  reauthenticate: vi.fn(),
}));
vi.mock('@/app/EncryptionPasswordModal', () => ({ EncryptionPasswordModal: () => null }));
vi.mock('@/shared/components/RecoveryCodeDisplayModal', () => ({ RecoveryCodeDisplayModal: () => null }));
vi.mock('@/shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock('@/shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string, n: number) => `${k}:${n}`, language: 'ru' }),
}));
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { AccountVaultSection } from '@/features/settings/components/AccountVaultSection';

const wrapper = ({ children }: { children: ReactNode }) => h(ToastProvider, null, children);

// Отказ должен остаться необработанным для кода под тестом (void), но не
// уронить сам прогон: помечаем промис обработанным на стороне мока.
function rejectHandled(err: Error) {
  const p = Promise.reject(err);
  p.catch(() => {});
  return p;
}

beforeEach(() => { cleanup(); vi.clearAllMocks(); });

describe('d41c: отказ стирания ключа устройства при ручном замке назван', () => {
  it('clearDeviceKey отказал — тост ошибки/предупреждения, а не только «Сейф заперт»', async () => {
    clearDeviceKey.mockImplementation(() => rejectHandled(new Error('MARKER_DAILY_IDB_DOWN')));
    const { container } = render(h(AccountVaultSection, { userId: 'u-d41c' }), { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'settings_lock_vault' }));
    await waitFor(() => { expect(clearDeviceKey).toHaveBeenCalledWith('u-d41c'); });
    await act(async () => { await Promise.resolve(); });
    expect(
      container.querySelector('.text-accent-danger, .text-accent-warning'),
      'ключ устройства не стёрт (сейф автооткроется при перезагрузке), а человек видит только нейтральное «Сейф заперт»',
    ).toBeTruthy();
  });

  it('КОНТРОЛЬ: ключ стёрт — нейтральное «Сейф заперт», без ошибки', async () => {
    clearDeviceKey.mockResolvedValue(undefined);
    const { container } = render(h(AccountVaultSection, { userId: 'u-d41c' }), { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'settings_lock_vault' }));
    await waitFor(() => { expect(screen.getByText('settings_vault_locked_done')).toBeTruthy(); });
    expect(container.querySelector('.text-accent-danger, .text-accent-warning')).toBeNull();
  });
});
