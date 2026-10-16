import React from 'react';
import { DataProvider } from '../../../core/data';
import { AI_CONSENT_VERSION_REQUIRED } from '../../../core/constants/privacyVersion';
import { useLanguage } from '../../../shared/i18n';
import { cn } from '../../../core/utils/utils';

/**
 * Текст согласия и две галочки — одни и те же в окне при первом входе
 * (PrivacyModal) и в мастере приглашения (ON-2). Юридический текст обязан
 * быть один: два экземпляра рано или поздно разъедутся.
 */
/** Юридический текст согласия — отдельная часть, чтобы степпер первого входа
 *  (MC-6) мог показать его целиком под ссылкой, не переписывая формулировки. */
export function PrivacyConsentText() {
  const { t } = useLanguage();

  return (
    <div className="space-y-4 text-sm text-text-main/70 leading-relaxed">
      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-main/80">{t('privacy_consent_storage_title')}</h3>
        <p>{t('privacy_consent_storage_p1_before')}<strong>{t('privacy_consent_storage_p1_strong')}</strong>{t('privacy_consent_storage_p1_after')}</p>
        <p>{t('privacy_consent_storage_p2')}</p>
        <p>{t('privacy_consent_storage_p3')}</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-main/80">{t('privacy_consent_third_party_title')}</h3>
        <p>{t('privacy_consent_third_party_p1_before')}<strong>{t('privacy_consent_third_party_p1_strong')}</strong>{t('privacy_consent_third_party_p1_after')}</p>
        <p>{t('privacy_consent_third_party_p2')}</p>
        <p>{t('privacy_consent_third_party_p3')}</p>
        <p>{t('privacy_consent_third_party_p4')}</p>
      </div>

      <p className="text-xs pt-1">{t('privacy_consent_links_prefix')}<a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-soft underline">{t('privacy_consent_privacy_policy')}</a>{t('privacy_consent_and')}<a href="/terms" target="_blank" rel="noopener noreferrer" className="text-brand-soft underline">{t('privacy_consent_terms')}</a>.</p>
    </div>
  );
}

/**
 * Две галочки согласия. `large` — телефон: 15 px подпись и квадрат 24 px,
 * чтобы поле было видно и попасть в него было чем. На десктопе вариант не
 * используется, разметка остаётся прежней.
 */
export function PrivacyConsentCheckboxes({ checked, onChecked, aiConsent, onAiConsent, large = false, className, show = 'both' }: {
  checked: boolean;
  onChecked: (v: boolean) => void;
  aiConsent: boolean;
  onAiConsent: (v: boolean) => void;
  large?: boolean;
  /** SP SA-2: подвал степпера держит галочки плотнее, чем тело окна. */
  className?: string;
  /** SP SA-2: степпер разводит галочки — обязательная в подвале, ИИ-согласие в теле. */
  show?: 'both' | 'required' | 'ai';
}) {
  const { t } = useLanguage();
  const box = large ? 'h-6 w-6 mt-1' : 'mt-0.5';
  const caption = large ? 'text-[15px]' : 'text-xs';

  return (
    <div className={cn('border-t border-border-subtle/50', large ? 'pt-5 space-y-4 mt-5' : 'pt-4 space-y-3 mt-4', className)}>
      {show !== 'ai' && (
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChecked(e.target.checked)}
          className={cn('accent-brand-soft shrink-0', box)}
        />
        <span className={cn('text-text-main/70', caption)}>
          <span className="font-semibold text-text-main">{t('privacy_consent_required_label')}</span>
          {t('privacy_consent_accept_before')}<a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-soft underline">{t('privacy_consent_data_policy')}</a>{t('privacy_consent_and')}<a href="/terms" target="_blank" rel="noopener noreferrer" className="text-brand-soft underline">{t('privacy_consent_terms')}</a>
        </span>
      </label>
      )}

      {/* Отдельная галочка, и это принципиально. Тексты дневника по своей
          природе относятся к специальным категориям (ст. 10 152-ФЗ), а
          согласие на них, спрятанное в общее «согласен с политикой», не
          считается данным. Галочка не обязательна: отказ оставляет письмо и
          хранение записей, забирая только функции ИИ. */}
      {show !== 'required' && (
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={aiConsent}
          onChange={e => onAiConsent(e.target.checked)}
          className={cn('accent-brand-soft shrink-0', box)}
        />
        <span className={cn('text-text-main/70', caption)}>
          <span className="font-semibold text-text-main">{t('privacy_consent_ai_label')}</span>
          {t('privacy_consent_ai_text_before')}<a href="/consent" target="_blank" rel="noopener noreferrer" className="text-brand-soft underline">{t('privacy_consent_ai_link')}</a>{t('privacy_consent_ai_text_after')}
        </span>
      </label>
      )}
    </div>
  );
}

export function PrivacyConsentBody({ checked, onChecked, aiConsent, onAiConsent }: {
  checked: boolean;
  onChecked: (v: boolean) => void;
  aiConsent: boolean;
  onAiConsent: (v: boolean) => void;
}) {
  const { t } = useLanguage();

  return (
    <>
    <p className="text-xs text-text-main/60 mb-4">
      {t('privacy_consent_intro')}
    </p>

    {/* Текст обязан совпадать с тем, что приложение делает на самом деле:
        это не пояснение, а согласие, которое человек даёт.
        Меняется поведение — правится и этот текст, в том же коммите. */}
    <PrivacyConsentText />

    <PrivacyConsentCheckboxes
      checked={checked}
      onChecked={onChecked}
      aiConsent={aiConsent}
      onAiConsent={onAiConsent}
    />
    </>
  );
}

/** Записывает согласие в профиль и в локальный кэш (usePrivacyCheck). */
export async function savePrivacyConsent(uid: string, aiConsent: boolean): Promise<void> {
  await DataProvider.updateProfile(uid, {
    privacyAcceptedAt: new Date(),
    privacyVersion: AI_CONSENT_VERSION_REQUIRED,
    // Согласие на спецкатегории пишется отдельным полем и отдельной
    // отметкой времени: оно даётся и отзывается независимо от согласия с
    // политикой, и доказывать их придётся по отдельности.
    //
    // R7F-004: незаложенная галка — это «не даю прямо сейчас», а не «отзываю».
    // Запись null стирала согласие, данное раньше (на другом устройстве или до
    // сбоя чтения профиля), и вместе с ним серверного свидетеля
    // ai_consent_server_at. Отзыв — только в настройках, явным действием.
    ...(aiConsent ? { aiConsentAt: new Date(), aiConsentVersion: AI_CONSENT_VERSION_REQUIRED } : {}),
  } as Record<string, unknown>);
  // R7Q-013: в Safari с «блокировать все файлы cookie» запись бросает.
  // намеренно: кэш — только ускорение, истина в строке профиля выше; отказ кэша
  // не имеет права отвергать принятое согласие.
  try { localStorage.setItem(`privacy_accepted_${uid}`, String(AI_CONSENT_VERSION_REQUIRED)); } catch { /* намеренно: нет хранилища */ }
}
