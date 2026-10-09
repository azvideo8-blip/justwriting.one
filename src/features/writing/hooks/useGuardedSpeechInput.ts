import { useCallback } from 'react';
import { useSpeechInput } from '../../../shared/hooks/useSpeechInput';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { useLanguage } from '../../../shared/i18n';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

interface UseGuardedSpeechInputProps {
  onSessionEnd: (fullText: string) => void;
  onError?: ((error: string) => void) | undefined;
}

export function useGuardedSpeechInput({ onSessionEnd, onError }: UseGuardedSpeechInputProps) {
  const { isListening, liveText, interimText, startListening, stopListening, cancel, hasSupport } = useSpeechInput({ onSessionEnd, onError });
  const { confirm } = useConfirmDialog();
  const { t } = useLanguage();
  const { user } = useAuthStatus();

  const isVaultActive = user ? useEncryptionStore.getState().getEncryptionEnabled(user.uid) : false;

  const toggleListening = useCallback(async () => {
    if (isListening) {
      stopListening();
      return;
    }

    const isVault = user ? useEncryptionStore.getState().getEncryptionEnabled(user.uid) : false;
    // D-5: предупреждение переписано (текст диктовки уходит в ИИ-сервис за знаками
    // препинания), поэтому оно показывается ещё раз тем, кто видел только v1.
    const noticeSeen = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2) === '1';

    if (isVault) {
      const ok = await confirm({
        title: t('voice_confirm_title'),
        message: t('voice_confirm_vault_desc'),
        confirmLabel: t('voice_confirm_continue'),
        cancelLabel: t('common_cancel'),
      });
      if (!ok) return;
    } else if (!noticeSeen) {
      const ok = await confirm({
        title: t('voice_confirm_title'),
        message: t('voice_confirm_desc'),
        confirmLabel: t('voice_confirm_ok'),
        cancelLabel: t('common_cancel'),
      });
      if (!ok) return;
      try {
        // v1 остаётся записанным: откат на предыдущую сборку не должен снова
        // показывать старое предупреждение человеку, который уже согласился.
        localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN, '1');
        localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2, '1');
      } catch {
        // ignore quota/private mode errors
      }
    }

    startListening();
  }, [confirm, isListening, startListening, stopListening, t, user]);

  return {
    isListening,
    liveText,
    interimText,
    toggleListening,
    startListening,
    stopListening,
    cancel,
    hasSupport,
    isVaultActive,
  };
}
