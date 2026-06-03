import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Shield } from 'lucide-react';
import { auth } from '../../../core/firebase/auth';
import { getClient } from '../../../core/firebase/firestoreClient';
import { Button } from '../../../shared/components/Button';

interface PrivacyModalProps {
  onAccepted: () => void;
}

export function PrivacyModal({ onAccepted }: PrivacyModalProps) {
  const [checked, setChecked] = useState(false);

  const handleAccept = async () => {
    if (!checked) return;
    const user = auth.currentUser;
    if (!user) return;

    const { db, mod } = await getClient();
    const { doc, setDoc, serverTimestamp } = mod;
    const userDoc = doc(db, 'users', user.uid);
    await setDoc(userDoc, {
      privacyAcceptedAt: serverTimestamp(),
      privacyVersion: 1,
    }, { merge: true });

    localStorage.setItem(`privacy_accepted_${user.uid}`, 'true');
    onAccepted();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md bg-surface-card border border-border-subtle rounded-2xl shadow-2xl overflow-hidden m-4"
      >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Shield size={20} className="text-brand-soft" />
            <h2 className="text-base font-bold text-text-main">Политика конфиденциальности</h2>
          </div>

          <div className="space-y-3 text-sm text-text-main/70 leading-relaxed">
            <p>Ваши тексты хранятся локально и в зашифрованном виде в облаке.</p>
            <p>При использовании ИИ-функций текст документа передаётся в API Gemini (Google) и нигде не сохраняется на наших серверах.</p>
            <p>Мы собираем анонимную статистику использования (кол-во запросов, токены).</p>
            <p>Вы можете удалить все данные в настройках.</p>
          </div>

          <label className="flex items-start gap-3 mt-5 cursor-pointer">
            <input
              type="checkbox"
              checked={checked}
              onChange={e => setChecked(e.target.checked)}
              className="mt-0.5 accent-brand-soft"
            />
            <span className="text-xs text-text-main/60">Я прочитал и согласен с политикой конфиденциальности</span>
          </label>

          <Button
            onClick={() => void handleAccept()}
            disabled={!checked}
            className="w-full mt-4 py-2.5 rounded-xl bg-brand-soft text-surface-base text-sm font-bold disabled:opacity-40 transition-colors"
          >
            Продолжить
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

export function usePrivacyCheck() {
  const [showPrivacy, setShowPrivacy] = useState(false);

  useEffect(() => {
    const check = async () => {
      const user = auth.currentUser;
      if (!user) return;

      const cached = localStorage.getItem(`privacy_accepted_${user.uid}`);
      if (cached === 'true') return;

      try {
        const { db, mod } = await getClient();
        const { doc, getDoc } = mod;
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists() && snap.data()?.privacyAcceptedAt) {
          localStorage.setItem(`privacy_accepted_${user.uid}`, 'true');
          return;
        }
        setShowPrivacy(true);
      } catch {
        setShowPrivacy(true);
      }
    };
    void check();
  }, []);

  return { showPrivacy, setShowPrivacy };
}
