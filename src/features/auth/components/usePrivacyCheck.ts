import { useState, useEffect } from 'react';
import { DataProvider } from '../../../core/data';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { PRIVACY_VERSION } from '../../../core/constants/privacyVersion';

// Отдельно от PrivacyModal: проверка нужна при каждом запуске, а само окно —
// редко. Так окно грузится лениво и не лежит в стартовом куске.
export function usePrivacyCheck() {
  const [showPrivacy, setShowPrivacy] = useState(false);
  const { user, authState } = useAuthStatus();

  useEffect(() => {
    if (authState === 'loading') return;
    // The effect now re-runs on an account switch, and getDoc is async: without
    // this flag a late answer about the previous uid would raise the modal for
    // whoever is signed in by then.
    let cancelled = false;

    const check = async () => {
      if (!user) {
        setShowPrivacy(false);
        return;
      }

      // В кэше держим принятую версию, а не «true»: иначе человек, согласившийся
      // со старым текстом, никогда не увидит новый.
      const cached = localStorage.getItem(`privacy_accepted_${user.uid}`);
      if (cached === String(PRIVACY_VERSION)) {
        setShowPrivacy(false);
        return;
      }

      try {
        const profile = await DataProvider.getProfile(user.uid);
        if (cancelled) return;
        const accepted = profile?.privacyAcceptedAt !== undefined && profile.privacyAcceptedAt !== null;
        const version = typeof profile?.privacyVersion === 'number' ? profile.privacyVersion : 0;
        if (accepted && version >= PRIVACY_VERSION) {
          localStorage.setItem(`privacy_accepted_${user.uid}`, String(PRIVACY_VERSION));
          setShowPrivacy(false);
          return;
        }
        setShowPrivacy(true);
      } catch {
        if (!cancelled) setShowPrivacy(true);
      }
    };
    void check();
    return () => { cancelled = true; };
  }, [user, authState]);

  return { showPrivacy, setShowPrivacy };
}
