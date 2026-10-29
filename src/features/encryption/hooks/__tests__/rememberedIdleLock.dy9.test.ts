// Дейлик 29.10 Н-3 (DY9-3), владелец: «сделай настоящей». При «запомнить на
// устройстве» часовой таймер простоя запирал сейф, а useEncryptionSetup.check()
// тут же открывал его снова сохранённым ключом. Теперь запертый по простою
// сейф открывается только паролем; перезагрузка страницы — прежнее «без пароля».
// Мутация: убрать проверку isLockedByIdle() в check() → (a) красный.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const auth = { user: { uid: 'u_dy9_idle' }, profile: { marker: 'MARKER_DY9_IDLE' }, refreshProfile: async () => {} };
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => auth }));

let verification = '';
vi.mock('../../../../core/services/EncryptionMetaService', () => ({
  hasEncryptionMeta: async () => true,
  getEncryptionMeta: async () => ({ salt: 's', wrappedDataKey: 'w', verification, version: 2 }),
}));
vi.mock('../../../../core/services/LegacyKeyMigration', () => ({ hasLegacyEncryption: () => false }));
vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: { reviveLockedTasks: async () => {}, syncPending: async () => {} },
}));

import { generateDataKey, encryptContent, setSessionKey } from '../../../../core/crypto/encrypt';
import { useEncryptionStore, setRememberDevice } from '../../../../core/crypto/useEncryptionStore';
import { saveDeviceKey } from '../../../../core/crypto/keyVaultCache';
import { useEncryptionSetup } from '../useEncryptionSetup';

async function openRememberedVault() {
  const key = await generateDataKey();
  verification = await encryptContent('justwriting-verify-v1', key);
  await saveDeviceKey(auth.user.uid, key);
  setSessionKey(key);
  setRememberDevice(true);
  const hook = renderHook(() => useEncryptionSetup());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { hook, key };
}

/** Час простоя — настоящим таймером стора, а не прямым вызовом lockVault. */
function passIdleHour() {
  vi.useFakeTimers();
  setRememberDevice(true); // перезапускает таймер уже на подменённых часах
  act(() => { vi.advanceTimersByTime(60 * 60 * 1000 + 1); });
  vi.useRealTimers();
}

afterEach(() => { vi.useRealTimers(); useEncryptionStore.getState().lockVault(); });

describe('DY9-3: часовой потолок «запомнить на устройстве» запирает по-настоящему', () => {
  it('(a) после часа простоя сейф заперт и просит пароль', async () => {
    const { hook } = await openRememberedVault();
    expect(useEncryptionStore.getState().isVaultUnlocked).toBe(true);
    passIdleHour();
    await new Promise(r => setTimeout(r, 200));
    expect(useEncryptionStore.getState().isVaultUnlocked).toBe(false);
    await waitFor(() => expect(hook.result.current.mode).toBe('unlock'));
    hook.unmount();
  });

  it('(b) после ввода пароля отметка снята: сейф открыт', async () => {
    const { hook, key } = await openRememberedVault();
    passIdleHour();
    await new Promise(r => setTimeout(r, 200));
    act(() => { setSessionKey(key); }); // то, чем заканчивается разблокировка паролем
    expect(useEncryptionStore.getState().isVaultUnlocked).toBe(true);
    hook.unmount();
  });
});
