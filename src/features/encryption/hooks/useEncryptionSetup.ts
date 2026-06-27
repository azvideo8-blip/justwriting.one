import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { isVaultUnlocked, setSessionKey } from '../../../core/crypto/encrypt';
import { useEncryptionStore, setRememberDevice } from '../../../core/crypto/useEncryptionStore';
import { loadDeviceKey, clearDeviceKey } from '../../../core/crypto/keyVaultCache';
import { hasEncryptionMeta, getEncryptionMeta } from '../../../core/services/EncryptionMetaService';
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
  const isVaultUnlockedVal = useEncryptionStore(s => s.isVaultUnlocked);

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
          // Verify the cached key against the stored verification ciphertext
          // to detect stale keys from re-initialization on another device.
          const meta = await getEncryptionMeta(user.uid);
          // V-4: require a NON-EMPTY verification string to auto-unlock.
          // Empty string '' is falsy but getEncryptionMeta returns '' when the
          // field is missing — refuse auto-unlock and fall through to password
          // prompt to avoid accepting a possibly-wrong cached device key.
          if (meta?.verification) {
            try {
              const { decryptContent } = await import('../../../core/crypto/encrypt');
              const result = await decryptContent(meta.verification, deviceKey);
              if (result !== 'justwriting-verify-v1') {
                // Key doesn't match — stale, clear it
                await clearDeviceKey(user.uid);
                setMode('unlock');
                setLoading(false);
                return;
              }
            } catch {
              // Decryption failed — stale or corrupted key
              await clearDeviceKey(user.uid);
              setMode('unlock');
              setLoading(false);
              return;
            }
            setSessionKey(deviceKey);
            setRememberDevice(true);
            setMode('none');
          } else {
            // V-4: verification string missing/empty — refuse auto-unlock,
            // force password prompt (do not call setSessionKey).
            setMode('unlock');
          }
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
      void check();
    }
  }, [user?.uid, check]);

  // Re-check when vault transitions from unlocked to locked (auto-lock / explicit lock)
  const wasUnlockedRef = useRef(false);
  useEffect(() => {
    if (isVaultUnlockedVal) {
      wasUnlockedRef.current = true;
    } else if (wasUnlockedRef.current) {
      wasUnlockedRef.current = false;
      // Vault just locked — re-check to show unlock prompt
      void check();
    }
  }, [isVaultUnlockedVal, check]);

  return { mode, isLegacy, loading, check };
}
