import React from 'react';
import { LogIn, BarChart3 } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { useTheme } from '../../../core/theme/ThemeProvider';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { useLoginModal } from '../../../app/useLoginModal';
import { Section } from './SettingsHelpers';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { cn } from '../../../core/utils/utils';
import { Button } from '../../../shared/components/Button';
import { analytics } from '../../../core/analytics/analytics';

interface AppTabProps {
  userId: string;
  onRefreshLifeLog?: (() => void) | undefined;
}

export function AppTab({ userId: _userId, onRefreshLifeLog: _onRefreshLifeLog }: AppTabProps) {
  const { t, language, setLanguage } = useLanguage();
  const { themeId, setThemeId, themes } = useTheme();
  const { isAuthenticated, isGuest } = useAuthStatus();
  const { openLoginModal } = useLoginModal();
  const [autoSync, setAutoSync] = React.useState(
    localStorage.getItem(STORAGE_KEYS.AUTO_SYNC_ENABLED) !== 'false'
  );
  const [autoSummarize, setAutoSummarize] = React.useState(
    localStorage.getItem(STORAGE_KEYS.AUTO_SUMMARIZE_ENABLED) !== 'false'
  );
  const [analyticsConsent, setAnalyticsConsent] = React.useState(
    localStorage.getItem('analytics_consent') === 'true'
  );

  const THEME_ACCENT: Record<string, string> = {
    modern:    '#1e1e22',
    notion:    '#e8dfc0',
    spotify:   '#1ed760',
    amethyst:  '#7c3aed',
  };

  const toggleAutoSync = () => {
    const newVal = !autoSync;
    setAutoSync(newVal);
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED, String(newVal));
  };

  const toggleAutoSummarize = () => {
    const newVal = !autoSummarize;
    setAutoSummarize(newVal);
    localStorage.setItem(STORAGE_KEYS.AUTO_SUMMARIZE_ENABLED, String(newVal));
  };

  const toggleAnalytics = () => {
    const newVal = !analyticsConsent;
    setAnalyticsConsent(newVal);
    if (newVal) analytics.optIn();
    else analytics.optOut();
  };

  return (
    <div className="space-y-4 mt-2">
      <Section title={t('settings_section_storage')}>
        <div className="text-label-sm text-text-main/60 mb-3 px-1">
          {t('settings_storage_hint')}
        </div>

        {isAuthenticated && (
          <div className="flex items-center justify-between px-1 mb-3">
            <span className="text-sm text-text-main/60">Автосинхронизация с облаком</span>
            <button
              onClick={toggleAutoSync}
              role="switch"
              aria-checked={autoSync}
              className={cn(
                "relative w-10 h-5 rounded-full transition-colors",
                autoSync ? "bg-brand-soft" : "bg-text-main/20"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                  autoSync ? "left-5" : "left-0.5"
                )}
              />
            </button>
          </div>
        )}

        <div className="flex items-center justify-between px-1 mb-3">
          <div className="flex-1 text-left pr-4">
            <span className="text-sm text-text-main/60">{t('settings_auto_summarize')}</span>
            <p className="text-xs text-text-main/60 mt-0.5">{t('settings_auto_summarize_hint')}</p>
          </div>
          <button
            onClick={toggleAutoSummarize}
            role="switch"
            aria-checked={autoSummarize}
            className={cn(
              "relative w-10 h-5 rounded-full transition-colors shrink-0",
              autoSummarize ? "bg-brand-soft" : "bg-text-main/20"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                autoSummarize ? "left-5" : "left-0.5"
              )}
            />
          </button>
        </div>

        {isGuest && (
          <Button
            onClick={openLoginModal}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-colors"
          >
            <LogIn size={14} />
            {t('storage_sign_in_for_cloud')}
          </Button>
        )}
      </Section>

      <Section title={language === 'ru' ? 'Конфиденциальность' : 'Privacy'}>
        <div className="flex items-center justify-between px-1 mb-3">
          <div className="flex-1 text-left pr-4">
            <span className="text-sm text-text-main/60 flex items-center gap-2">
              <BarChart3 size={14} className="text-text-main/60" />
              {language === 'ru' ? 'Аналитика использования' : 'Usage analytics'}
            </span>
            <p className="text-xs text-text-main/60 mt-0.5">
              {language === 'ru' ? 'Анонимная статистика через PostHog (ЕС)' : 'Anonymous statistics via PostHog (EU)'}
            </p>
          </div>
          <button
            onClick={toggleAnalytics}
            role="switch"
            aria-checked={analyticsConsent}
            aria-label={language === 'ru' ? 'Аналитика использования' : 'Usage analytics'}
            className={cn(
              "relative w-10 h-5 rounded-full transition-colors shrink-0",
              analyticsConsent ? "bg-brand-soft" : "bg-text-main/20"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                analyticsConsent ? "left-5" : "left-0.5"
              )}
            />
          </button>
        </div>

        <a
          href="/privacy"
          className="block text-xs text-text-main/60 hover:text-text-main transition-colors px-1 py-1"
        >
          {language === 'ru' ? 'Политика конфиденциальности' : 'Privacy Policy'}
        </a>
        <a
          href="/terms"
          className="block text-xs text-text-main/60 hover:text-text-main transition-colors px-1 py-1"
        >
          {language === 'ru' ? 'Условия использования' : 'Terms of Service'}
        </a>
        <a
          href="/privacy"
          className="block text-xs text-text-main/60 hover:text-text-main transition-colors px-1 py-1"
        >
          {language === 'ru' ? 'Не продавать мои данные (CCPA)' : 'Do Not Sell My Personal Information'}
        </a>
      </Section>

      <Section title={t('profile_theme_title')}>
        <p className="text-xs text-text-muted -mt-1 mb-2">
          {t('profile_theme_hint')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {Object.values(themes).map(theme => (
            <Button
              key={theme.id}
              onClick={() => setThemeId(theme.id)}
              className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors text-left ${
                themeId === theme.id
                  ? "border-text-main bg-text-main text-surface-base"
                  : "border-border-subtle text-text-main/60 hover:text-text-main hover:border-text-main/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full shrink-0 border border-black/10"
                  style={THEME_ACCENT[theme.id] ? { backgroundColor: THEME_ACCENT[theme.id] } : undefined}
                />
                <span>{language === 'ru' ? theme.nameRu : theme.nameEn}</span>
              </div>
            </Button>
          ))}
        </div>
      </Section>

      <Section title={t('settings_language')}>
        <div className="grid grid-cols-2 gap-2">
          {(['ru', 'en'] as const).map(lang => (
            <Button
              key={lang}
              onClick={() => setLanguage(lang)}
              className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                language === lang
                  ? "border-text-main bg-text-main text-surface-base"
                  : "border-border-subtle text-text-main/60 hover:text-text-main"
              }`}
            >
              {lang === 'ru' ? '🇷🇺 Русский' : '🇺🇸 English'}
            </Button>
          ))}
        </div>
      </Section>
    </div>
  );
}
