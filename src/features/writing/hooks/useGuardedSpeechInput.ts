import { useCallback } from 'react';
import { useSpeechInput } from '../../../shared/hooks/useSpeechInput';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { useLanguage } from '../../../shared/i18n';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

interface UseGuardedSpeechInputProps {
  onTranscript: (text: string) => void;
}

export function useGuardedSpeechInput({ onTranscript }: UseGuardedSpeechInputProps) {
  const { isListening, startListening, stopListening, hasSupport } = useSpeechInput({ onTranscript });
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
    const noticeSeen = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN) === '1';

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
        localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN, '1');
      } catch {
        // ignore quota/private mode errors
      }
    }

    startListening();
  }, [confirm, isListening, startListening, stopListening, t, user]);

  return {
    isListening,
    toggleListening,
    startListening,
    stopListening,
    hasSupport,
    isVaultActive,
  };
}
