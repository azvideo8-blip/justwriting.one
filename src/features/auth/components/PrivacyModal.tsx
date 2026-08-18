import { useState, useEffect } from 'react';
import { reportError } from '../../../shared/errors/reportError';
import { motion } from 'motion/react';
import { Shield } from 'lucide-react';
import { getCurrentUser } from '../../../core/auth';
import { DataProvider } from '../../../core/data';
import { Button } from '../../../shared/components/Button';
import { useAuthStatus } from '../../../app/useAuthStatus';

interface PrivacyModalProps {
  onAccepted: () => void;
}

export function PrivacyModal({ onAccepted }: PrivacyModalProps) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [aiConsent, setAiConsent] = useState(false);

  const handleAccept = async () => {
    if (!checked) return;
    const user = getCurrentUser();
    if (!user) return;

    // Без try/catch любая неудача записи выглядела как «кнопка не нажимается»:
    // окно оставалось на месте и молчало. На это ушло полдня 2026-08-18.
    setSaveError(null);
    setSaving(true);
    try {
      await DataProvider.updateProfile(user.uid, {
        privacyAcceptedAt: new Date(),
        privacyVersion: PRIVACY_VERSION,
        // Согласие на спецкатегории пишется отдельным полем и отдельной
        // отметкой времени: оно даётся и отзывается независимо от согласия с
        // политикой, и доказывать их придётся по отдельности.
        aiConsentAt: aiConsent ? new Date() : null,
        aiConsentVersion: aiConsent ? PRIVACY_VERSION : null,
      } as Record<string, unknown>);
    } catch (e) {
      reportError(e, { action: 'privacyAccept', userId: user.uid });
      setSaveError('Не удалось сохранить согласие. Проверьте связь и попробуйте ещё раз.');
      return;
    } finally {
      setSaving(false);
    }

    localStorage.setItem(`privacy_accepted_${user.uid}`, String(PRIVACY_VERSION));
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

          {/* Текст обязан совпадать с тем, что приложение делает на самом деле:
              это не пояснение, а согласие, которое человек даёт. Прежняя версия
              обещала Langfuse, PostHog и Sentry — ни одного из них нет, зато
              умалчивала о том, что запрос к модели может уйти за границу.
              Меняется поведение — правится и этот текст, в том же коммите. */}
          <div className="space-y-3 text-sm text-text-main/70 leading-relaxed">
            <p>Заметки хранятся на вашем устройстве. Если включена синхронизация, копия уезжает на наш сервер в России — <strong>содержимое, заголовки и теги зашифрованы</strong> ключом, который выводится из вашего пароля и на сервер не попадает. Открытыми остаются только даты, длительность сессий и счётчики слов.</p>
            <p>Текст заметки уходит поставщику ИИ <strong>только по вашему действию</strong>: когда вы нажимаете разбор у заметки или задаёте вопрос в чате. Сам по себе, в фоне, он не отправляется никогда.</p>
            <p>Поставщик — RouterAI (Россия). Он не хранит содержимое запросов, но по умолчанию может передать запрос зарубежному сервису, который вычисляет ответ и таких гарантий не даёт. Мы ищем решение; пока честнее сказать прямо.</p>
            <p>Если в заметке упомянуты другие люди, их слова и обстоятельства уходят вместе с текстом. Отдельной картотеки упомянутых людей приложение не ведёт.</p>
            <p>Аналитики, счётчиков и отправки ошибок посторонним сервисам нет.</p>
            <p>Удаление аккаунта удаляет заметки, историю и всё, что было по ним посчитано.</p>
            <p>Подробнее: <a href="/privacy" className="text-brand-soft underline">Политика конфиденциальности</a> и <a href="/terms" className="text-brand-soft underline">Условия использования</a>.</p>
          </div>

          <label className="flex items-start gap-3 mt-5 cursor-pointer">
            <input
              type="checkbox"
              checked={checked}
              onChange={e => setChecked(e.target.checked)}
              className="mt-0.5 accent-brand-soft"
            />
            <span className="text-xs text-text-main/60">
              Я прочитал и принимаю <a href="/privacy" className="text-brand-soft underline">Политику обработки персональных данных</a> и <a href="/terms" className="text-brand-soft underline">Условия использования</a>
            </span>
          </label>

          {/* Отдельная галочка, и это принципиально. Тексты дневника по своей
              природе относятся к специальным категориям (ст. 10 152-ФЗ), а
              согласие на них, спрятанное в общее «согласен с политикой», не
              считается данным. Галочка не обязательна: отказ оставляет письмо и
              хранение записей, забирая только функции ИИ. */}
          <label className="flex items-start gap-3 mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={aiConsent}
              onChange={e => setAiConsent(e.target.checked)}
              className="mt-0.5 accent-brand-soft"
            />
            <span className="text-xs text-text-main/60">
              Я даю <a href="/consent" className="text-brand-soft underline">согласие на обработку специальных категорий персональных данных</a> — сведений о состоянии здоровья, психоэмоциональном состоянии и личной жизни, которые могут содержаться в моих записях, — для работы функций ИИ. Без этого согласия письмо и хранение записей остаются доступными, функции ИИ — нет
            </span>
          </label>

          {saveError !== null && (
            <p className="mt-3 text-xs text-accent-danger">{saveError}</p>
          )}

          <Button
            onClick={() => void handleAccept()}
            disabled={!checked || saving}
            className="w-full mt-4 py-2.5 rounded-xl bg-brand-soft text-surface-base text-sm font-bold disabled:opacity-40 transition-colors"
          >
            Продолжить
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// Версия текста согласия. Поднимается вместе с любым содержательным изменением
// формулировок: согласие, данное на прежний текст, нового не покрывает. Версия 2
// (2026-08-18) — первая, где сказано, что запрос к модели может уйти за границу.
export const PRIVACY_VERSION = 2;

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
