import React from 'react';
import { Cloud, LogIn } from 'lucide-react';
import { useLanguage } from '../../../core/i18n';
import { useTheme } from '../../../core/theme/ThemeProvider';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { useLoginModal } from '../../auth/contexts/LoginModalContext';
import { SyncService } from '../../../core/services/SyncService';
import { useToast } from '../../../shared/components/Toast';
import { Section } from './SettingsHelpers';

interface AppTabProps {
  userId: string;
  onRefreshLifeLog?: () => void;
}

export function AppTab({ userId, onRefreshLifeLog }: AppTabProps) {
  const { t, language, setLanguage } = useLanguage();
  const { themeId, setThemeId, themes } = useTheme();
  const { isAuthenticated, isGuest } = useAuthStatus();
  const { openLoginModal } = useLoginModal();
  const { showToast } = useToast();

  const THEME_ACCENT: Record<string, string> = {
    modern:    '#1e1e22',
    notion:    '#e8dfc0',
    spotify:   '#1ed760',
    amethyst:  '#7c3aed',
  };

  const handleSyncNow = async () => {
    try {
      const result = await SyncService.syncAllUnlinked(userId);
      if (result.failed > 0) {
        showToast(t('admin_import_failed', { count: result.failed }), 'error');
      } else {
        showToast(t('offline_synced'), 'success');
      }
      onRefreshLifeLog?.();
    } catch {
      showToast(t('error_generic_action'), 'error');
    }
  };

  return (
    <div className="space-y-4 mt-2">
      <Section title={t('settings_section_storage')}>
        <div className="text-label-sm text-text-main/40 mb-3 px-1">
          {t('settings_storage_hint')}
        </div>

        {isAuthenticated && (
          <button
            onClick={handleSyncNow}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-colors"
          >
            <Cloud size={14} />
            {t('settings_upload_to_cloud')}
          </button>
        )}

        {isGuest && (
          <button
            onClick={openLoginModal}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-border-subtle text-sm text-text-main/40 hover:text-text-main transition-colors"
          >
            <LogIn size={14} />
            {t('storage_sign_in_for_cloud')}
          </button>
        )}
      </Section>

      <Section title={t('profile_theme_title')}>
        <p className="text-xs text-text-muted -mt-1 mb-2">
          {t('profile_theme_hint')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {Object.values(themes).map(theme => (
            <button
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
                  style={{ backgroundColor: THEME_ACCENT[theme.id] }}
                />
                <span>{language === 'ru' ? theme.nameRu : theme.nameEn}</span>
              </div>
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('settings_language')}>
        <div className="grid grid-cols-2 gap-2">
          {(['ru', 'en'] as const).map(lang => (
            <button
              key={lang}
              onClick={() => setLanguage(lang)}
              className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                language === lang
                  ? "border-text-main bg-text-main text-surface-base"
                  : "border-border-subtle text-text-main/60 hover:text-text-main"
              }`}
            >
              {lang === 'ru' ? '🇷🇺 Русский' : '🇺🇸 English'}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}
