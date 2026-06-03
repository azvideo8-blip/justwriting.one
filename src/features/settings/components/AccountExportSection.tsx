import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { reportError } from '../../../shared/errors/reportError';
import { useAuthStatus } from '../../auth/hooks/useAuthStatus';
import { loadAllSessions } from '../../writing/services/UnifiedSessionLoader';
import { exportAllAsZip } from '../../export/ExportAllService';
import { ExportStrings } from '../../archive/services/ArchiveExportService';
import { Section } from './SettingsHelpers';
import { Button } from '../../../shared/components/Button';

interface AccountExportSectionProps {
  userId: string;
}

export function AccountExportSection({ userId }: AccountExportSectionProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { user } = useAuthStatus();
  const [loading, setLoading] = useState(false);

  const handleExportAll = async () => {
    setLoading(true);
    try {
      const { sessions } = await loadAllSessions(userId, user);
      if (sessions.length === 0) {
        showToast(t('settings_export_all_empty'), 'error');
        return;
      }
      const strings: ExportStrings = {
        date: t('export_header_date'),
        words: t('export_header_words'),
        time: t('export_header_time'),
        tags: t('export_header_tags'),
        untitled: t('export_untitled'),
        untitledFilename: t('export_filename_default'),
      };
      const { exported, skipped } = await exportAllAsZip(sessions, strings);
      showToast(t('settings_export_all_done', { count: exported }), 'success');
      if (skipped > 0) {
        showToast(t('settings_export_all_skipped', { count: skipped }), 'error');
      }
    } catch (err) {
      reportError(err, { action: 'exportAllAsZip', userId });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section title={t('settings_export_all_title')}>
      <div className="p-4 rounded-xl border border-border-subtle space-y-3">
        <div className="text-xs text-text-main/60 leading-relaxed">{t('settings_export_all_desc')}</div>
        <Button
          onClick={() => void handleExportAll()}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-colors disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {t('settings_export_all_progress')}
            </>
          ) : (
            <>
              <Download size={16} className="text-text-main/40" />
              {t('settings_export_all_button')}
            </>
          )}
        </Button>
      </div>
    </Section>
  );
}
