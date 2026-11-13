import { useAiConsentStore, isProfileLoaded } from './aiConsent';
import { getCurrentUser } from '../auth';

/**
 * TR-5: «ИИ выключен» — только когда профиль прочитан и согласия в нём нет.
 * Тот же предикат, что у настоящих ворот (`callAi`): профиль не прочитан —
 * это «не знаем», а не «выключен», и подпись остаётся обычной.
 */
export function useAiConsentOff(): boolean {
  const uid = getCurrentUser()?.uid;
  const consent = useAiConsentStore(s => (uid ? s.consents[uid] : undefined));
  return !!uid && isProfileLoaded(uid) && !consent;
}
