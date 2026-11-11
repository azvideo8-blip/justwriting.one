import { Sparkles, Shield, X, Check, Search } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { ModalShell } from '../../../shared/components/ModalShell';
import { useLanguage } from '../../../shared/i18n';

interface IndexingConsentModalProps {
  isOpen: boolean;
  onConsent: () => void;
  onRefuse: () => void;
}

export function IndexingConsentModal({ isOpen, onConsent, onRefuse }: IndexingConsentModalProps) {
  const { t } = useLanguage();

  if (!isOpen) return null;

  return (
    <ModalShell
      open={isOpen}
      onClose={onRefuse}
      labelId="indexing-consent-title"
      className="bg-surface-card border border-border-subtle rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-brand-soft" />
          <h3 id="indexing-consent-title" className="text-sm font-bold text-text-main">{t('indexing_consent_title')}</h3>
        </div>
          <IconButton
            onClick={onRefuse}
            className="p-1.5 rounded-lg text-text-main/60 hover:text-text-main transition-colors"
            label={t('common_close')}
            icon={<X size={18} />}
          />
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-xs text-text-main/80 leading-relaxed">
          <p>
            {t('indexing_consent_desc')}
          </p>

          <div className="p-3 rounded-xl bg-surface-base/40 border border-border-subtle space-y-2">
            <div className="flex items-center gap-2 font-medium text-text-main">
              <Shield size={14} className="text-brand-soft" />
              <span>{t('indexing_consent_data_title')}</span>
            </div>
            <ul className="list-disc pl-4 space-y-1 text-text-main/70">
              <li>
                <strong>{t('indexing_consent_what_sent_title')}</strong> {t('indexing_consent_what_sent_desc')}
              </li>
              <li>
                <strong>{t('indexing_consent_when_sent_title')}</strong> {t('indexing_consent_when_sent_desc')}
              </li>
              <li>
                <strong>{t('indexing_consent_what_returned_title')}</strong> {t('indexing_consent_what_returned_desc')}
              </li>
            </ul>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-accent-danger/5 border border-accent-danger/20 space-y-1.5">
              <div className="font-semibold text-accent-danger flex items-center gap-1.5">
                <X size={13} />
                <span>{t('indexing_consent_disabled_title')}</span>
              </div>
              <ul className="list-disc pl-4 space-y-1 text-text-main/60 text-[11px]">
                <li>{t('indexing_consent_disabled_item_1')}</li>
                <li>{t('indexing_consent_disabled_item_2')}</li>
                <li>{t('indexing_consent_disabled_item_3')}</li>
              </ul>
            </div>

            <div className="p-3 rounded-xl bg-accent-success/5 border border-accent-success/20 space-y-1.5">
              <div className="font-semibold text-accent-success flex items-center gap-1.5">
                <Check size={13} />
                <span>{t('indexing_consent_enabled_title')}</span>
              </div>
              <ul className="list-disc pl-4 space-y-1 text-text-main/60 text-[11px]">
                <li>{t('indexing_consent_enabled_item_1')}</li>
                <li>{t('indexing_consent_enabled_item_2')}</li>
                <li>{t('indexing_consent_enabled_item_3')}</li>
                <li>{t('indexing_consent_enabled_item_4')}</li>
              </ul>
            </div>
          </div>

          <p className="text-text-main/50 text-[11px]">
            {t('indexing_consent_footer')}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 p-4 border-t border-border-subtle bg-surface-card/50">
          <Button
            onClick={onRefuse}
            className="flex-1 py-2.5 px-4 rounded-xl border border-border-subtle text-xs font-medium text-text-main/70 hover:bg-surface-base/50 transition-colors flex items-center justify-center gap-1.5"
          >
            <Search size={13} />
            {t('indexing_consent_btn_words_only')}
          </Button>
          <Button
            onClick={onConsent}
            className="flex-1 py-2.5 px-4 rounded-xl bg-brand-soft text-surface-base text-xs font-medium hover:bg-brand-soft-hover transition-colors flex items-center justify-center gap-1.5 shadow-sm"
          >
            <Sparkles size={13} />
            {t('indexing_consent_btn_enable')}
          </Button>
        </div>
    </ModalShell>
  );
}
