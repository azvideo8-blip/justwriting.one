import React from 'react';
import { DataProvider } from '../../../core/data';
import { AI_CONSENT_VERSION_REQUIRED } from '../../../core/constants/privacyVersion';
import { useLanguage } from '../../../shared/i18n';

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
  const { t } = useLanguage();

  return (
    <>
    <p className="text-xs text-text-main/60 mb-4">
      {t('privacy_consent_intro')}
    </p>

    {/* Текст обязан совпадать с тем, что приложение делает на самом деле:
        это не пояснение, а согласие, которое человек даёт.
        Меняется поведение — правится и этот текст, в том же коммите. */}
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

    <div className="pt-4 border-t border-border-subtle/50 space-y-3 mt-4">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChecked(e.target.checked)}
          className="mt-0.5 accent-brand-soft shrink-0"
        />
        <span className="text-xs text-text-main/70">
          <span className="font-semibold text-text-main">{t('privacy_consent_required_label')}</span>
          {t('privacy_consent_accept_before')}<a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-soft underline">{t('privacy_consent_data_policy')}</a>{t('privacy_consent_and')}<a href="/terms" target="_blank" rel="noopener noreferrer" className="text-brand-soft underline">{t('privacy_consent_terms')}</a>
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
          <span className="font-semibold text-text-main">{t('privacy_consent_ai_label')}</span>
          {t('privacy_consent_ai_text_before')}<a href="/consent" target="_blank" rel="noopener noreferrer" className="text-brand-soft underline">{t('privacy_consent_ai_link')}</a>{t('privacy_consent_ai_text_after')}
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
    privacyVersion: AI_CONSENT_VERSION_REQUIRED,
    // Согласие на спецкатегории пишется отдельным полем и отдельной
    // отметкой времени: оно даётся и отзывается независимо от согласия с
    // политикой, и доказывать их придётся по отдельности.
    aiConsentAt: aiConsent ? new Date() : null,
    aiConsentVersion: aiConsent ? AI_CONSENT_VERSION_REQUIRED : null,
  } as Record<string, unknown>);
  localStorage.setItem(`privacy_accepted_${uid}`, String(AI_CONSENT_VERSION_REQUIRED));
}
