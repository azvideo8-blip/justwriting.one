import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { isVaultUnlocked, setSessionKey, decryptContent } from '../../../core/crypto/encrypt';
import { useEncryptionStore, setRememberDevice } from '../../../core/crypto/useEncryptionStore';
import { loadDeviceKey, clearDeviceKey } from '../../../core/crypto/keyVaultCache';
import { setEncryptionEnabled } from '../../../core/crypto/cryptoHelpers';
import { hasEncryptionMeta, getEncryptionMeta } from '../../../core/services/EncryptionMetaService';
import { hasLegacyEncryption } from '../../../core/services/LegacyKeyMigration';
import { reportError } from '../../../shared/errors/reportError';

export type EncryptionModalMode = 'none' | 'setup' | 'unlock' | 'migrate';

export function useEncryptionSetup(): {
  mode: EncryptionModalMode;
  isLegacy: boolean;
  loading: boolean;
  check: () => Promise<void>;
  dismiss: () => void;
} {
  const { user, profile, refreshProfile } = useAuthStatus();
  const [mode, setMode] = useState<EncryptionModalMode>('none');
  const [isLegacy, setIsLegacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const prevUidRef = useRef<string | null>(null);
  const prevProfileRef = useRef<unknown>(null);
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
      if (isVaultUnlocked()) {
        setMode('none');
        setLoading(false);
        return;
      }
      if (hasNew) {
        // "Remember on this device": auto-unlock from the cached key, no prompt.
        const deviceKey = await loadDeviceKey(user.uid);
        if (isVaultUnlocked()) {
          setMode('none');
          setLoading(false);
          return;
        }
        if (deviceKey) {
          // Verify the cached key against the stored verification ciphertext
          // to detect stale keys from re-initialization on another device.
          const meta = await getEncryptionMeta(user.uid);
          if (isVaultUnlocked()) {
            setMode('none');
            setLoading(false);
            return;
          }
          // V-4: require a NON-EMPTY verification string to auto-unlock.
          // Empty string '' is falsy but getEncryptionMeta returns '' when the
          // field is missing — refuse auto-unlock and fall through to password
          // prompt to avoid accepting a possibly-wrong cached device key.
          if (meta?.verification) {
            try {
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
            setEncryptionEnabled(user.uid, true);
            setMode('none');
            void refreshProfile().catch(() => {});
            try {
              const { SyncService } = await import('../../../core/services/SyncService');
              await SyncService.reviveLockedTasks(user.uid);
              void SyncService.syncPending(user.uid);
            } catch { /* non-critical */ }
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
        // EA-16: сейфа нет (автосоздание при входе не удалось) — без него в
        // облако ничего не уходит, поэтому предлагаем создать его сразу.
        setMode('setup');
      }
    } catch (e) {
      // We could not read encryptionMeta, so we do NOT know whether this vault
      // has already been migrated. Offering migration here is fail-dangerous:
      // a Firestore read failure (quota exhausted, connection dropped) used to
      // present an irreversible re-wrap prompt to a user whose vault was fine,
      // with no way to dismiss it. Migration must require a positive signal
      // that the new metadata is absent — never the absence of an answer.
      reportError(e, { action: 'encryptionSetup_metaReadFailed', userId: user.uid }, 'warning');
      setMode('none');
    }
    setLoading(false);
  }, [user, profile, refreshProfile]);

  useEffect(() => {
    const uid = user?.uid ?? null;
    if (uid !== prevUidRef.current || profile !== prevProfileRef.current) {
      prevUidRef.current = uid;
      prevProfileRef.current = profile;
      void check();
    }
  }, [user?.uid, profile, check]);

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

  // Lets the caller dismiss the prompt. Every mode here is recoverable from
  // elsewhere in the UI (the note view offers unlock, settings offer setup and
  // migration), and a modal with no exit is a trap — a wrong `migrate` verdict
  // used to lock the whole app behind an irreversible action.
  const dismiss = useCallback(() => setMode('none'), []);

  // D-2: «Разблокировать» в предпросмотре запертой заметки и «Продолжить» в
  // тосте «Заметка заперта» шлют это событие. Пока модалка живёт здесь,
  // слушатель — тоже здесь, иначе окно пришлось бы дублировать.
  useEffect(() => {
    if (!user) return;
    const onOpenUnlock = () => {
      if (isVaultUnlocked()) return;
      setMode('unlock');
    };
    window.addEventListener('open-vault-unlock', onOpenUnlock);
    return () => window.removeEventListener('open-vault-unlock', onOpenUnlock);
  }, [user]);

  // Вход открывает сейф паролем уже после события смены пользователя: check()
  // успевает решить «unlock», и окно висело над открытым сейфом.
  // ON-1: то же с «создайте сейф» — мастер приглашения создаёт и открывает сейф
  // при входе, а проверка успела решить «сейфа нет» ещё по сессии из ссылки.
  const effectiveMode = (mode === 'unlock' || mode === 'setup') && isVaultUnlockedVal ? 'none' : mode;

  return { mode: effectiveMode, isLegacy, loading, check, dismiss };
}
