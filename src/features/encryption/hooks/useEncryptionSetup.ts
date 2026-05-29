import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { isVaultUnlocked } from '../../../core/crypto/encrypt';
import { hasEncryptionMeta } from '../../../core/services/EncryptionMetaService';
import { hasLegacyEncryption } from '../../../core/services/LegacyKeyMigration';

export type EncryptionModalMode = 'none' | 'setup' | 'unlock' | 'migrate' | 'change';

export function useEncryptionSetup(): {
  mode: EncryptionModalMode;
  isLegacy: boolean;
  loading: boolean;
  check: () => void;
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
        setMode('unlock');
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
