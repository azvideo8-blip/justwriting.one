import { createContext, useCallback, useContext, useState, useEffect, useRef, useMemo, ReactNode } from 'react';
import { DataProvider } from '../../../core/data';
import { UserProfile } from '../../../types';
import { userProfileDbSchema } from '../../../core/data/schemas';
import { setEncryptionEnabled, setProfileLoaded } from '../../../core/crypto/cryptoHelpers';
import { setAiConsent } from '../../../core/ai/aiConsent';
import { PRIVACY_VERSION } from '../components/PrivacyModal';
import { reportError } from '../../../shared/errors/reportError';
import { useAuth } from './AuthContext';

interface ProfileContextValue {
  profile: UserProfile | null;
  /** Перечитать профиль из базы напрямую.
   *
   *  Нужен после записи, результат которой сразу показывается в интерфейсе.
   *  Подписка на изменения для этого не годится: логическая репликация не
   *  присылает неизменённые TOAST-значения, а мы намеренно сливаем снапшот с
   *  прежним профилем, чтобы не терять поля. Значит новое значение
   *  encryption_meta может не приехать вовсе — и плашка «код восстановления не
   *  создан» продолжает висеть над только что созданным кодом. */
  refreshProfile: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue>({
  profile: null,
  refreshProfile: async () => {},
});

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const creationAttemptedRef = useRef(false);
  const profileSetBySnapshotRef = useRef(false);

  useEffect(() => {
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting profile when user signs out
      setProfile(null);
      setProfileLoaded('guest', true);
      setAiConsent('guest', false);
      creationAttemptedRef.current = false;
      return;
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const unsubscribe = DataProvider.subscribeToProfile(user.uid, (data) => {
      if (cancelled) return;
      void (async () => {
        try {
          if (data) {
            if (typeof data === 'object' && data != null && 'uid' in data) {
              const parsed = userProfileDbSchema.safeParse(data);
              if (parsed.success) {
                profileSetBySnapshotRef.current = true;
                // Слияние, а не замена. Логическая репликация не присылает
                // неизменённые TOAST-значения, и fromDb выбрасывает null'ы —
                // поэтому в снапшоте может просто не быть encryption_meta у
                // аккаунта с сейфом. Замена целиком означала бы, что после
                // любой чужой записи в строку интерфейс решает «шифрование не
                // настроено»: раздел настроек предлагает завести сейф поверх
                // существующего, а импорт архива блокируется.
                setProfile(prev => (prev ? { ...prev, ...parsed.data } : parsed.data));
                // Флаг только включаем и никогда не снимаем по снапшоту.
                // Снапшот приходит из postgres_changes, а логическая репликация
                // не присылает неизменённые TOAST-значения: у аккаунта с сейфом
                // encryption_meta может просто отсутствовать в payload. Снять
                // флаг на этом означало бы решить «шифрования нет» по отсутствию
                // ответа, после чего maybeEncrypt отдаёт заметки в облако
                // открытым текстом. Оставленный флаг в худшем случае даёт
                // ENCRYPT_REQUIRED на запертом сейфе — отказ записи, не утечку.
                if (!!(parsed.data.encryptionSalt && parsed.data.encryptedDataKey) || !!parsed.data.encryptionMeta) {
                  setEncryptionEnabled(user.uid, true);
                }

                // Согласие на спецкатегории (ст. 10 152-ФЗ):
                // Снапшот приходит из postgres_changes, а логическая репликация не присылает
                // неизменённые TOAST-значения, и fromDb выбрасывает null'ы для отсутствующих полей.
                // Отсутствие ai_consent_at в снапшоте не означает отзыва согласия.
                // Обновляем флаг согласия по снапшоту ТОЛЬКО если поле aiConsentAt явно в нём присутствует.
                // Снимать согласие допустимо при явном aiConsentAt === null в payload либо по authoritative getProfile.
                if (parsed.data.aiConsentAt !== undefined) {
                  const hasConsent = parsed.data.aiConsentAt !== null &&
                    typeof parsed.data.aiConsentVersion === 'number' &&
                    parsed.data.aiConsentVersion >= PRIVACY_VERSION;
                  setAiConsent(user.uid, hasConsent);
                }

                setProfileLoaded(user.uid, true);
              } else {
                if (import.meta.env.DEV) console.warn('Invalid profile data for uid:', user.uid, parsed.error.flatten());
                setProfile(null);
                setProfileLoaded(user.uid, true);
              }
            } else {
              if (import.meta.env.DEV) console.warn('Invalid profile data for uid:', user.uid, data);
              setProfile(null);
              setProfileLoaded(user.uid, true);
            }
          } else {
            // No profile doc exists. Create it.
            //
            // Флаг шифрования здесь не снимаем: пустой снапшот не доказывает,
            // что профиль пропал, а authoritative getProfile ниже может вернуть
            // профиль с сейфом — и раньше флаг успевал сброситься до этой
            // проверки. Новому аккаунту сброс не нужен: getEncryptionEnabled
            // возвращает false, когда для uid ничего не записано.
            if (creationAttemptedRef.current) return;
            creationAttemptedRef.current = true;

            const existingProfile = await DataProvider.getProfile(user.uid);
            if (existingProfile) {
              creationAttemptedRef.current = false;
              const hasConsent = existingProfile.aiConsentAt !== null &&
                existingProfile.aiConsentAt !== undefined &&
                typeof existingProfile.aiConsentVersion === 'number' &&
                existingProfile.aiConsentVersion >= PRIVACY_VERSION;
              setAiConsent(user.uid, hasConsent);
              return;
            }

            const initialProfile: UserProfile = {
              uid: user.uid,
              email: user.email || '',
              nickname: user.displayName || user.email?.split('@')[0] || 'User'
            };

            if (import.meta.env.DEV) {
              console.warn('Creating initial user profile:', JSON.stringify(initialProfile));
            }

            try {
              await DataProvider.updateProfile(user.uid, initialProfile as unknown as Record<string, unknown>);
              creationAttemptedRef.current = false;
              if (!cancelled && !profileSetBySnapshotRef.current) {
                setProfile(initialProfile);
                setProfileLoaded(user.uid, true);
              }
            } catch (err) {
              reportError(err, { action: 'createUserProfile', uid: user.uid });
              creationAttemptedRef.current = false;
              if (!cancelled) {
                setProfile(null);
                setProfileLoaded(user.uid, true);
              }
            }
          }
        } catch (e) {
          reportError(e, { action: 'profileContext_init', uid: user.uid });
        }
      })();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user]);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    try {
      const fresh = await DataProvider.getProfile(user.uid);
      if (!fresh) return;
      const parsed = userProfileDbSchema.safeParse(fresh);
      if (!parsed.success) return;
      // Здесь замена, а не слияние: это авторитетное чтение целиком, а не
      // снапшот с пропущенными полями.
      setProfile(parsed.data);
    } catch (e) {
      reportError(e, { action: 'refreshProfile', userId: user.uid });
    }
  }, [user]);

  const value = useMemo(() => ({ profile, refreshProfile }), [profile, refreshProfile]);

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  return useContext(ProfileContext);
}

export { ProfileContext };
