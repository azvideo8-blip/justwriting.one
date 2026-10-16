import { useState, useEffect } from 'react';
import { DataProvider } from '../../../core/data';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { AI_CONSENT_VERSION_REQUIRED } from '../../../core/constants/privacyVersion';

// Отдельно от PrivacyModal: проверка нужна при каждом запуске, а само окно —
// редко. Так окно грузится лениво и не лежит в стартовом куске.
// suspended: пока открыт мастер приглашения (он берёт согласие сам). Когда он
// закрылся, проверка перезапускается и видит уже записанное согласие — раньше
// она решала «показать» ещё по ссылке из письма и показывала окно после мастера.

/**
 * R7F-004: падение чтения — это «неизвестно», а не «согласия нет». На новом
 * устройстве этот запрос единственный источник истины (кэш пуст), и раньше его
 * ошибка поднимала шаг политики: человек подтверждал только политику, а галка ИИ
 * по умолчанию снята → `savePrivacyConsent` писал `aiConsentAt: null` и стирал
 * уже данное согласие вместе с серверным свидетелем.
 */
const READ_RETRY_DELAYS_MS = [2_000, 10_000, 30_000];

export function usePrivacyCheck(suspended = false) {
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [recheck, setRecheck] = useState(0);
  const { user, authState } = useAuthStatus();

  // Молчание после сбоя не должно означать «вопрос не задали никогда»: сеть
  // вернулась — читаем заново.
  useEffect(() => {
    const onOnline = () => setRecheck(n => n + 1);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  useEffect(() => {
    if (authState === 'loading') return;
    // The effect now re-runs on an account switch, and getDoc is async: without
    // this flag a late answer about the previous uid would raise the modal for
    // whoever is signed in by then.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async (attempt: number) => {
      if (!user || suspended) {
        setShowPrivacy(false);
        return;
      }

      // В кэше держим принятую версию, а не «true»: иначе человек, согласившийся
      // со старым текстом, никогда не увидит новый.
      const cached = localStorage.getItem(`privacy_accepted_${user.uid}`);
      if (cached === String(AI_CONSENT_VERSION_REQUIRED)) {
        setShowPrivacy(false);
        return;
      }

      let profile: Awaited<ReturnType<typeof DataProvider.getProfile>>;
      try {
        profile = await DataProvider.getProfile(user.uid);
      } catch {
        if (cancelled) return;
        if (attempt < READ_RETRY_DELAYS_MS.length) {
          timer = setTimeout(() => void check(attempt + 1), READ_RETRY_DELAYS_MS[attempt]);
        }
        return;   // «неизвестно»: ничего деструктивного не показываем
      }
      if (cancelled) return;
      const accepted = profile?.privacyAcceptedAt !== undefined && profile.privacyAcceptedAt !== null;
      const version = typeof profile?.privacyVersion === 'number' ? profile.privacyVersion : 0;
      if (accepted && version >= AI_CONSENT_VERSION_REQUIRED) {
        localStorage.setItem(`privacy_accepted_${user.uid}`, String(AI_CONSENT_VERSION_REQUIRED));
        setShowPrivacy(false);
        return;
      }
      setShowPrivacy(true);
    };
    void check(0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [user, authState, suspended, recheck]);

  return { showPrivacy, setShowPrivacy };
}
