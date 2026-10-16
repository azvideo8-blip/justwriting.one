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

  /** MF-5: `noticeHandled` — предупреждение уже показал лист на телефоне, и
   *  нажатие «Записать» — это и есть согласие. Старт идёт в том же такте, без
   *  await до startListening: иначе iOS не даёт микрофон. */
  const toggleListening = useCallback(async (opts?: { noticeHandled?: boolean }) => {
    if (isListening) {
      stopListening();
      return;
    }
    if (opts?.noticeHandled) {
      markDictationNoticeSeen(user?.uid ?? null);
      startListening();
      return;
    }

    const isVault = user ? useEncryptionStore.getState().getEncryptionEnabled(user.uid) : false;
    // D-5: предупреждение переписано (текст диктовки уходит в ИИ-сервис за знаками
    // препинания), поэтому оно показывается ещё раз тем, кто видел только v1.
    // R7F-015: отметка принадлежит аккаунту. Гость живёт под гостевым ключом:
    // он не «другой зарегистрированный аккаунт», и подметание при выходе его
    // стирает (LS-6).
    const noticeUid = user?.uid ?? 'guest';
    const noticeSeen = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2(noticeUid)) === '1';

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
      markDictationNoticeSeen(user?.uid ?? null);
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

function markDictationNoticeSeen(uid: string | null): void {
  try {
    // v1 остаётся записанным на устройстве: откат на предыдущую сборку не должен
    // снова показывать старое предупреждение человеку, который уже согласился.
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN, '1');
    localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2(uid ?? 'guest'), '1');
  } catch {
    // намеренно: приватный режим и переполнение квоты — согласие от этого не
    // отзывается, предупреждение просто будет показано снова.
  }
}

/** MF-5: показывать ли лист «Голосовой ввод» перед записью на телефоне. С сейфом —
 *  всегда и без галочки; приватную часть — хотя бы раз (V2); дальше — пока не
 *  отмечено «Больше не показывать» этим человеком. */
export function voiceNoticeDecision(uid: string | null, vault: boolean): 'vault' | 'sheet' | 'start' {
  if (vault) return 'vault';
  try {
    if (!uid || localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_SEEN_V2(uid)) !== '1') return 'sheet';
    if (uid && localStorage.getItem(STORAGE_KEYS.DICTATION_NOTICE_DISMISSED(uid)) === '1') return 'start';
  } catch {
    // приватный режим: лист показывается, запись не ломается
  }
  return 'sheet';
}

export function dismissVoiceNotice(uid: string | null): void {
  if (!uid) return;
  try { localStorage.setItem(STORAGE_KEYS.DICTATION_NOTICE_DISMISSED(uid), '1'); } catch { /* приватный режим */ }
}
