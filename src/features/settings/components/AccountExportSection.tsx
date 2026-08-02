import { useState } from 'react';
import { Download, Loader2, FileJson, Database } from 'lucide-react';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { reportError } from '../../../shared/errors/reportError';
import { useAuthStatus } from '../../../app/useAuthStatus';
import { loadAllSessions, hydrateSessionContent } from '../../../core/services/UnifiedSessionLoader';
import { exportAllAsZip } from '../../export/ExportAllService';
import { ExportStrings } from '../../archive/services/ArchiveExportService';
import { Section } from './SettingsHelpers';
import { Button } from '../../../shared/components/Button';
import { saveAs } from 'file-saver';
import { APP_VERSION } from '../../../version';
import { exportMigrationManifest } from '../services/migrationExport';

interface AccountExportSectionProps {
  userId: string;
}

export function AccountExportSection({ userId }: AccountExportSectionProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { user } = useAuthStatus();
  const [loading, setLoading] = useState(false);
  const [jsonLoading, setJsonLoading] = useState(false);
  const [migrationLoading, setMigrationLoading] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{
    documents: number; versions: number; verbatim: number; skipped: number;
  } | null>(null);

  const handleExportAll = async () => {
    setLoading(true);
    try {
      const { sessions: listed } = await loadAllSessions(userId, user);
      if (listed.length === 0) {
        showToast(t('settings_export_all_empty'), 'error');
        return;
      }
      // The archive list leaves cloud-only notes without their text. A backup
      // must carry the text, so fetch it here — this is the one place the reads
      // are worth paying for, and without it every such note is written out as
      // an empty file and counted as exported.
      const sessions = await hydrateSessionContent(listed, user?.uid ?? userId);
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
      reportError(err, { action: 'exportAllAsZip' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleExportJson = async () => {
    setJsonLoading(true);
    try {
      const { sessions: listed } = await loadAllSessions(userId, user);
      const sessions = await hydrateSessionContent(listed, user?.uid ?? userId);
      const profileData: Record<string, unknown> = {
        nickname: user?.displayName ?? null,
        email: user?.email ?? null,
      };
      const exportableSessions = sessions.filter(s => !s._locked && !s._decryptionError && !s._contentError && !s._contentNotLoaded);
      const skippedCount = sessions.length - exportableSessions.length;
      const exportData = {
        exportedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        profile: profileData,
        sessions: exportableSessions
          .map(s => ({
            id: s.id,
            title: s.title ?? null,
            content: s.content,
            wordCount: s.wordCount ?? null,
            charCount: s.charCount ?? null,
            duration: s.duration ?? null,
            wpm: s.wpm ?? null,
            createdAt: s.createdAt ?? null,
            tags: s.tags ?? [],
            mood: s.mood ?? null,
            isPublic: s.isPublic ?? false,
          })),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      saveAs(blob, `justwriting-export-${new Date().toISOString().slice(0, 10)}.json`);
      showToast(t('settings_export_all_done', { count: exportableSessions.length }), 'success');
      if (skippedCount > 0) {
        showToast(t('settings_export_all_skipped', { count: skippedCount }), 'error');
      }
    } catch (err) {
      reportError(err, { action: 'exportJson' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setJsonLoading(false);
    }
  };

  const handleMigrationExport = async () => {
    setMigrationLoading(true);
    setMigrationResult(null);
    try {
      const manifest = await exportMigrationManifest();
      const verbatimTotal = Object.values(manifest.counters.verbatim).reduce((a, b) => a + b, 0);
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
      saveAs(blob, `justwriting-export-${new Date().toISOString().slice(0, 10)}.json`);
      setMigrationResult({
        documents: manifest.counters.documents,
        versions: manifest.counters.versions,
        verbatim: verbatimTotal,
        skipped: manifest.skipped.length,
      });
    } catch (err) {
      reportError(err, { action: 'migrationExport' });
      showToast(t('error_generic_action'), 'error');
    } finally {
      setMigrationLoading(false);
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
              <Download size={16} className="text-text-main/60" />
              {t('settings_export_all_button')}
            </>
          )}
        </Button>
        <Button
          onClick={() => void handleExportJson()}
          disabled={jsonLoading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-colors disabled:opacity-50"
        >
          {jsonLoading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {t('settings_export_all_progress')}
            </>
          ) : (
            <>
              <FileJson size={16} className="text-text-main/60" />
              {t('settings_export_json_button')}
            </>
          )}
        </Button>
        <Button
          onClick={() => void handleMigrationExport()}
          disabled={migrationLoading}
          data-testid="migration-export-btn"
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-border-subtle text-sm text-text-main/60 hover:text-text-main transition-colors disabled:opacity-50"
        >
          {migrationLoading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {t('settings_migration_export_progress')}
            </>
          ) : (
            <>
              <Database size={16} className="text-text-main/60" />
              {t('settings_migration_export_button')}
            </>
          )}
        </Button>
        {migrationResult && (
          <div className="text-xs text-text-main/60 leading-relaxed space-y-1">
            <div>
              {t('settings_migration_export_done', {
                documents: String(migrationResult.documents),
                versions: String(migrationResult.versions),
                verbatim: String(migrationResult.verbatim),
              })}
            </div>
            {migrationResult.skipped > 0 && (
              <div className="text-red-500">
                {t('settings_migration_export_skipped', { count: String(migrationResult.skipped) })}
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
