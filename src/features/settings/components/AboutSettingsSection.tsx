import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info, FileText, Bug, ExternalLink, HelpCircle } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { useAdminStatus } from '../../auth/hooks/useAdminStatus';
import { APP_VERSION } from '../../../version';
import { Section } from './SettingsHelpers';
import { Button } from '../../../shared/components/Button';
import { useChangelogSeenStore } from '../../../shared/changelog/useChangelogSeenStore';

export function AboutSettingsSection() {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { isAdmin } = useAdminStatus();
  const hasUnseenChangelog = useChangelogSeenStore(s => s.hasUnseen);
  const [diagnosticsUnlocked, setDiagnosticsUnlocked] = useState(
    () => sessionStorage.getItem('diagnostics_unlocked') === 'true'
  );

  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    };
  }, []);

  const handleVersionTap = () => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 3000);
    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0;
      sessionStorage.setItem('diagnostics_unlocked', 'true');
      setDiagnosticsUnlocked(true);
      showToast(t('settings_diagnostics_active'), 'success');
    }
  };

  const showDiagnostics = isAdmin || diagnosticsUnlocked;

  return (
    <Section>

      <div className="p-4 rounded-xl border border-border-subtle space-y-4">
        {/* Version & Easter Egg */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Info size={16} className="text-text-main/60" />
            <span className="text-sm font-medium text-text-main">justwriting</span>
          </div>
          <span
            onClick={handleVersionTap}
            tabIndex={0}
            role="button"
            aria-label={`Версия ${APP_VERSION}`}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleVersionTap(); } }}
            className="text-xs font-mono text-text-main/70 bg-surface-base/40 px-2.5 py-1 rounded-md border border-border-subtle cursor-pointer select-none hover:text-text-main"
          >
            v{APP_VERSION}
          </span>
        </div>

        {/* Navigation links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-border-subtle">
          <Button
            onClick={() => void navigate('/changelog')}
            className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border-subtle text-xs text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors text-left"
          >
            <span className="flex items-center gap-2">
              <FileText size={14} className="text-text-main/50" />
              {language === 'ru' ? 'Журнал изменений' : 'Changelog'}
              {hasUnseenChangelog && (
                <span className="w-1.5 h-1.5 rounded-full bg-brand-primary shrink-0" aria-hidden="true" />
              )}
            </span>
            <ExternalLink size={12} className="text-text-main/40" />
          </Button>

          <Button
            onClick={() => void navigate('/about')}
            className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border-subtle text-xs text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors text-left"
          >
            <span className="flex items-center gap-2">
              <Info size={14} className="text-text-main/50" />
              {language === 'ru' ? 'О проекте' : 'About'}
            </span>
            <ExternalLink size={12} className="text-text-main/40" />
          </Button>

          <Button
            onClick={() => void navigate('/help')}
            className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border-subtle text-xs text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors text-left"
          >
            <span className="flex items-center gap-2">
              <HelpCircle size={14} className="text-text-main/50" />
              {language === 'ru' ? 'Помощь: заметки не видны?' : 'Help & Troubleshooting'}
            </span>
            <ExternalLink size={12} className="text-text-main/40" />
          </Button>

          <a
            href="/privacy"
            className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border-subtle text-xs text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors"
          >
            <span>{language === 'ru' ? 'Политика конфиденциальности' : 'Privacy Policy'}</span>
            <ExternalLink size={12} className="text-text-main/40" />
          </a>

          <a
            href="/terms"
            className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border-subtle text-xs text-text-main/70 hover:text-text-main hover:bg-text-main/5 transition-colors"
          >
            <span>{language === 'ru' ? 'Условия использования' : 'Terms of Service'}</span>
            <ExternalLink size={12} className="text-text-main/40" />
          </a>
        </div>

        <a
          href="/privacy"
          className="block text-xs text-text-main/50 hover:text-text-main transition-colors px-1"
        >
          {language === 'ru' ? 'Не продавать мои данные (CCPA)' : 'Do Not Sell My Personal Information'}
        </a>

        {/* Diagnostics tool (if admin or unlocked) */}
        {showDiagnostics && (
          <div className="pt-2 border-t border-border-subtle">
            <Button
              onClick={() => void navigate('/diagnostics')}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-accent-danger/30 text-xs text-accent-danger hover:bg-accent-danger/10 transition-colors font-medium"
            >
              <Bug size={14} />
              {t('settings_diagnostics_button')}
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
