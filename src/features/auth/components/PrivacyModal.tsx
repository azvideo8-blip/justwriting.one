import React, { useState } from 'react';
import { reportError } from '../../../shared/errors/reportError';
import { Shield } from 'lucide-react';
import { getCurrentUser } from '../../../core/auth';
import { DataProvider } from '../../../core/data';
import { Button } from '../../../shared/components/Button';
import { ModalShell } from '../../../shared/components/ModalShell';
import { PRIVACY_VERSION } from '../../../core/constants/privacyVersion';

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
    <ModalShell
      open
      labelId="privacy-modal-title"
      onClose={() => { /* обязательное согласие: Escape и клик по фону не закрывают */ }}
      className="w-full max-w-md max-h-[calc(100dvh-2rem)] bg-surface-card border border-border-subtle rounded-2xl shadow-2xl overflow-y-auto m-4"
    >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Shield size={20} className="text-brand-soft" />
            <h2 id="privacy-modal-title" className="text-base font-bold text-text-main">Политика конфиденциальности</h2>
          </div>

          <p className="text-xs text-text-main/60 mb-4">
            justwriting — приватный редактор для свободного письма. Вот как мы обращаемся с вашими данными:
          </p>

          {/* Текст обязан совпадать с тем, что приложение делает на самом деле:
              это не пояснение, а согласие, которое человек даёт.
              Меняется поведение — правится и этот текст, в том же коммите. */}
          <div className="space-y-4 text-sm text-text-main/70 leading-relaxed">
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-main/80">Как хранятся данные</h3>
              <p>Заметки хранятся на вашем устройстве. Если включена синхронизация, копия уезжает на наш сервер в России — <strong>содержимое, заголовки и теги зашифрованы</strong> ключом, который выводится из вашего пароля и на сервер не попадает. Открытыми остаются только даты, длительность сессий и счётчики слов.</p>
              <p>Аналитики, счётчиков и отправки ошибок посторонним сервисам нет.</p>
              <p>Удаление аккаунта удаляет заметки, историю и всё, что было по ним посчитано.</p>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-main/80">Что уходит третьим лицам</h3>
              <p>Текст уходит поставщику ИИ <strong>только когда вы пользуетесь ИИ</strong>: нажимаете разбор у заметки, отправляете сообщение в чате или просите ИИ-помощника. Вместе с ответом в чате приложение делает несколько служебных запросов с тем же разговором — придумывает название диалога, предлагает подсказки и сохраняет факты в «Память ИИ» (подсказки и память можно выключить в настройках). Без ваших действий тексты не отправляются.</p>
              <p>Поставщик — RouterAI (Россия). Он не хранит содержимое запросов, но по умолчанию может передать запрос зарубежному сервису, который вычисляет ответ и таких гарантий не даёт. Мы ищем решение; пока честнее сказать прямо.</p>
              <p>Голосовой ввод (диктовка) использует встроенное распознавание речи браузера: аудиозапись передаётся серверам вендора браузера (Google или Apple) для перевода в текст.</p>
              <p>Если в заметке упомянуты другие люди, их слова и обстоятельства уходят вместе с текстом. Отдельной картотеки упомянутых людей приложение не ведёт.</p>
            </div>

            <p className="text-xs pt-1">Подробнее: <a href="/privacy" className="text-brand-soft underline">Политика конфиденциальности</a> и <a href="/terms" className="text-brand-soft underline">Условия использования</a>.</p>
          </div>

          <div className="pt-4 border-t border-border-subtle/50 space-y-3 mt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={e => setChecked(e.target.checked)}
                className="mt-0.5 accent-brand-soft shrink-0"
              />
              <span className="text-xs text-text-main/70">
                <span className="font-semibold text-text-main">Обязательно: </span>
                Я прочитал и принимаю <a href="/privacy" className="text-brand-soft underline">Политику обработки персональных данных</a> и <a href="/terms" className="text-brand-soft underline">Условия использования</a>
              </span>
            </label>

            {/* Отдельная галочка, и это принципиально. Тексты дневника по своей
                природе относятся к специальным категориям (ст. 10 152-ФЗ), а
                согласие на них, спрятанное в общее «согласен с политикой», не
                считается данным. Галочка не обязательна: отказ оставляет письмо и
                хранение записей, забирая только функции ИИ. */}
            <div className="p-3 rounded-xl border border-border-subtle bg-surface-base/30 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-text-main">Функции искусственного интеллекта</span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface-elevated text-text-main/60 border border-border-subtle">
                  Необязательно
                </span>
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aiConsent}
                  onChange={e => setAiConsent(e.target.checked)}
                  className="mt-0.5 accent-brand-soft shrink-0"
                />
                <span className="text-xs text-text-main/60 leading-relaxed">
                  Я даю <a href="/consent" className="text-brand-soft underline">согласие на обработку специальных категорий персональных данных</a> — сведений о состоянии здоровья, психоэмоциональном состоянии и личной жизни, которые могут содержаться в моих записях, — для работы функций ИИ. Без этого согласия письмо и хранение записей остаются доступными, функции ИИ — нет
                </span>
              </label>
            </div>
          </div>

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
    </ModalShell>
  );
}

// Версия текста согласия. Поднимается вместе с любым содержательным изменением
// формулировок: согласие, данное на прежний текст, нового не покрывает. Версия 2
// (2026-08-18) — первая, где сказано, что запрос к модели может уйти за границу.


// Ре-экспорт для обратной совместимости: часть кода импортирует константу отсюда.
export { PRIVACY_VERSION };
