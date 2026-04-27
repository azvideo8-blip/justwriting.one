import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MigrationService, MigrationResult } from '../../writing/services/MigrationService';
import { useLanguage } from '../../../core/i18n';
import { getOrCreateGuestId } from '../../../shared/lib/localDb';
import { Upload, Check, X, Loader } from 'lucide-react';

interface PostLoginMigrationModalProps {
  userId: string;
  onDone: () => void;
}

type ModalState = 'prompt' | 'migrating' | 'success' | 'skipped';

export function PostLoginMigrationModal({ userId, onDone }: PostLoginMigrationModalProps) {
  const { t } = useLanguage();
  const [state, setState] = useState<ModalState>('prompt');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [localDocCount, setLocalDocCount] = useState(0);
  const guestId = getOrCreateGuestId();

  useEffect(() => {
    MigrationService.getLocalDocumentCount(guestId).then(count => {
      setLocalDocCount(count);
    });
  }, [guestId]);

  const handleMigrate = async () => {
    setState('migrating');
    try {
      const migrationResult = await MigrationService.migrateAllToCloud(
        guestId,
        userId,
        (current, total) => setProgress({ current, total })
      );
      setResult(migrationResult);
      setState('success');

      if (migrationResult.failed === 0) {
        await MigrationService.clearLocalData(guestId);
      }
    } catch (e) {
      console.error('Migration failed:', e);
      setState('prompt');
    }
  };

  const handleSkip = () => {
    setState('skipped');
    setTimeout(onDone, 800);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] bg-surface-base/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-sm bg-surface-card border border-border-subtle rounded-2xl p-6 shadow-lg"
      >
        <AnimatePresence mode="wait">
          {state === 'prompt' && (
            <motion.div
              key="prompt"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-4"
            >
              <div className="w-10 h-10 rounded-2xl bg-text-main/5 border border-border-subtle flex items-center justify-center">
                <Upload size={18} className="text-text-main/60" />
              </div>

              <div>
                <h2 className="text-base font-medium text-text-main mb-1">
                  {t('migration_prompt_title')}
                </h2>
                <p className="text-sm text-text-main/50">
                  {t('migration_prompt_hint', { count: localDocCount })}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={handleMigrate}
                  className="w-full py-2.5 rounded-xl bg-text-main text-surface-base text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  {t('migration_upload')}
                </button>
                <button
                  onClick={handleSkip}
                  className="w-full py-2.5 rounded-xl text-text-main/40 text-sm hover:text-text-main/60 transition-colors"
                >
                  {t('migration_skip')}
                </button>
              </div>
            </motion.div>
          )}

          {state === 'migrating' && (
            <motion.div
              key="migrating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4 py-4"
            >
              <Loader size={24} className="text-text-main/60 animate-spin" />
              <div className="text-center">
                <div className="text-sm font-medium text-text-main/80">
                  {t('migration_in_progress')}
                </div>
                {progress.total > 0 && (
                  <div className="text-xs text-text-main/40 mt-1">
                    {progress.current} / {progress.total}
                  </div>
                )}
              </div>
              {progress.total > 0 && (
                <div className="w-full h-1 bg-border-subtle rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-text-main rounded-full"
                    animate={{ width: `${(progress.current / progress.total) * 100}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              )}
            </motion.div>
          )}

          {state === 'success' && result && (
            <motion.div
              key="success"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4 py-4"
            >
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Check size={18} className="text-emerald-500" />
              </div>

              <div className="text-center">
                <div className="text-sm font-medium text-text-main/80">
                  {t('migration_success_title')}
                </div>
                <div className="text-xs text-text-main/40 mt-1">
                  {t('migration_success_count', { count: result.migrated })}
                </div>
                {result.failed > 0 && (
                  <div className="text-xs text-red-400/70 mt-1">
                    {t('migration_failed_count', { count: result.failed })}
                  </div>
                )}
              </div>

              <button
                onClick={onDone}
                className="w-full py-2.5 rounded-xl bg-text-main text-surface-base text-sm font-medium"
              >
                {t('migration_done')}
              </button>
            </motion.div>
          )}

          {state === 'skipped' && (
            <motion.div
              key="skipped"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-3 py-4"
            >
              <X size={20} className="text-text-main/30" />
              <div className="text-sm text-text-main/40">
                {t('migration_skipped')}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
