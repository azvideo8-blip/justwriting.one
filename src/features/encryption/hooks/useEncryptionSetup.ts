import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { isVaultUnlocked, setSessionKey } from '../../../core/crypto/encrypt';
import { loadDeviceKey } from '../../../core/crypto/keyVaultCache';
import { setRememberDevice } from '../../../core/crypto/useEncryptionStore';
import { hasEncryptionMeta } from '../../../core/services/EncryptionMetaService';
import { hasLegacyEncryption } from '../../../core/services/LegacyKeyMigration';

export type EncryptionModalMode = 'none' | 'setup' | 'unlock' | 'migrate' | 'change';

export function useEncryptionSetup(): {
  mode: EncryptionModalMode;
  isLegacy: boolean;
  loading: boolean;
  check: () => Promise<void>;
} {
  const { user, profile } = useAuthStatus();
  const [mode, setMode] = useState<EncryptionModalMode>('none');
  const [isLegacy, setIsLegacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const prevUidRef = useRef<string | null>(null);

  const check = useCallback(async () => {
    if (!user) {
      setMode('none');
      setLoading(false);
      return;
    }

    if (isVaultUnlocked()) {
      setMode('none');
      setLoading(false);
      return;
    }

    const legacy = hasLegacyEncryption(profile);
    setIsLegacy(legacy);

    try {
      const hasNew = await hasEncryptionMeta(user.uid);
      if (hasNew) {
        // "Remember on this device": auto-unlock from the cached key, no prompt.
        const deviceKey = await loadDeviceKey(user.uid);
        if (deviceKey) {
          setSessionKey(deviceKey);
          setRememberDevice(true);
          setMode('none');
        } else {
          setMode('unlock');
        }
      } else if (legacy) {
        setMode('migrate');
      } else {
        setMode('none');
      }
    } catch {
      if (legacy) {
        setMode('migrate');
      } else {
        setMode('none');
      }
    }
    setLoading(false);
  }, [user, profile]);

  useEffect(() => {
    const uid = user?.uid ?? null;
    if (uid !== prevUidRef.current) {
      prevUidRef.current = uid;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial encryption state check on auth change
      void check();
    }
  }, [user?.uid, check]);

  return { mode, isLegacy, loading, check };
}
