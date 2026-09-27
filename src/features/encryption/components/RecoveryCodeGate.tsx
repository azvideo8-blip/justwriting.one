import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { clearDeviceKey } from '../../../core/crypto/keyVaultCache';
import { setRememberDevice } from '../../../core/crypto/useEncryptionStore';
import { reportError } from '../../../shared/errors/reportError';

// Код показывается раз в жизни сейфа — модалка вынесена из стартового куска (бюджет CI).
const RecoveryCodeDisplayModal = lazy(() =>
  import('../../../shared/components/RecoveryCodeDisplayModal').then(m => ({ default: m.RecoveryCodeDisplayModal })),
);

export function RecoveryCodeGate() {
  const { user, isGuest } = useAuthStatus();

  // Derived on every render — reactive to user/isGuest changes without an effect.
  // No lazy initializer needed: the function is cheap and runs synchronously.
  const readPendingCode = useCallback(() => {
    if (!user || isGuest) return null;
    const key = STORAGE_KEYS.PENDING_RECOVERY_CODE(user.uid);
    try {
      // R3-2: старые версии клали код в localStorage бессрочно — переносим в
      // sessionStorage и стираем оттуда.
      const legacy = localStorage.getItem(key);
      if (legacy) {
        sessionStorage.setItem(key, legacy);
        localStorage.removeItem(key);
      }
      return sessionStorage.getItem(key) || null;
    } catch {
      return null;
    }
  }, [user, isGuest]);

  // A counter bumped by external storage events so React re-renders and
  // re-evaluates readPendingCode(). setState is called only from event
  // handlers — never in the effect body — so the ratchet stays silent.
  const [externalTick, setExternalTick] = useState(0);
  useEffect(() => {
    const handleUpdate = () => setExternalTick((t) => t + 1);
    window.addEventListener('pending_recovery_code_updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('pending_recovery_code_updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  // Compute the current value: changes whenever user, isGuest, or external
  // storage events change (externalTick forces a re-render).
  const pendingCode = externalTick >= 0 ? readPendingCode() : null;

  const handleConfirm = useCallback(({ rememberDevice }: { rememberDevice: boolean }) => {
    if (user && !rememberDevice) {
      // R3-9: сейф, созданный при входе, сам запоминает ключ на устройстве —
      // на чужом компьютере человек снимает галочку, и ключ забывается.
      setRememberDevice(false);
      void clearDeviceKey(user.uid).catch((err) => {
        reportError(err, { action: 'clearDeviceKey_uncheckRememberDevice', userId: user.uid });
      });
    }
    if (user) {
      try {
        sessionStorage.removeItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(user.uid));
        localStorage.removeItem(STORAGE_KEYS.PENDING_RECOVERY_CODE(user.uid));
      } catch {
        /* ignore */
      }
    }
    setExternalTick((t) => t + 1);
  }, [user]);

  if (!pendingCode || !user || isGuest) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <RecoveryCodeDisplayModal
        recoveryCode={pendingCode}
        onConfirm={handleConfirm}
        askRememberDevice
      />
    </Suspense>
  );
}
