import React from 'react';
import { DataProvider } from '../../../core/data';
import { PRIVACY_VERSION } from '../../../core/constants/privacyVersion';

/**
 * Текст согласия и две галочки — одни и те же в окне при первом входе
 * (PrivacyModal) и в мастере приглашения (ON-2). Юридический текст обязан
 * быть один: два экземпляра рано или поздно разъедутся.
 */
export function PrivacyConsentBody({ checked, onChecked, aiConsent, onAiConsent }: {
  checked: boolean;
  onChecked: (v: boolean) => void;
  aiConsent: boolean;
  onAiConsent: (v: boolean) => void;
}) {
  return (
    <>
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
        <p>Поставщик — RouterAI (Россия). Он не хранит содержимое запросов, но по умолчанию может передать запрос зарубежному сервису, который вычисляет ответ и таких гарантий не даёт.</p>
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
          onChange={e => onChecked(e.target.checked)}
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
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={aiConsent}
          onChange={e => onAiConsent(e.target.checked)}
          className="mt-0.5 accent-brand-soft shrink-0"
        />
        <span className="text-xs text-text-main/70">
          <span className="font-semibold text-text-main">Необязательно, для функций ИИ: </span>
          Я даю <a href="/consent" className="text-brand-soft underline">согласие на обработку специальных категорий персональных данных</a> — сведений о состоянии здоровья, психоэмоциональном состоянии и личной жизни, которые могут содержаться в моих записях, — для работы функций ИИ. Без этого согласия письмо и хранение записей остаются доступными, функции ИИ — нет
        </span>
      </label>
    </div>
    </>
  );
}

/** Записывает согласие в профиль и в локальный кэш (usePrivacyCheck). */
export async function savePrivacyConsent(uid: string, aiConsent: boolean): Promise<void> {
  await DataProvider.updateProfile(uid, {
    privacyAcceptedAt: new Date(),
    privacyVersion: PRIVACY_VERSION,
    // Согласие на спецкатегории пишется отдельным полем и отдельной
    // отметкой времени: оно даётся и отзывается независимо от согласия с
    // политикой, и доказывать их придётся по отдельности.
    aiConsentAt: aiConsent ? new Date() : null,
    aiConsentVersion: aiConsent ? PRIVACY_VERSION : null,
  } as Record<string, unknown>);
  localStorage.setItem(`privacy_accepted_${uid}`, String(PRIVACY_VERSION));
}
