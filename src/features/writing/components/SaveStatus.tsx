import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';
import { useWritingSettings } from '../../../core/settings/WritingSettingsContext';

export type SaveStatusKind = 'idle' | 'saving' | 'saved' | 'cloud-stale' | 'error';

// DC-W4: статус сохранения живёт внизу экрана письма, а не в шапке — при
// настройках по умолчанию шапка скрыта панелью журнала, а в дзен размонтируется,
// и сигнал «сохранено» до писателя не доходил вовсе.
export function SaveStatus({
  saveStatus,
  saveErrorKind,
}: {
  saveStatus: SaveStatusKind;
  saveErrorKind?: 'quota' | 'unknown' | null;
}) {
  const { t, language } = useLanguage();
  const { isZenActive } = useWritingSettings();
  const reducedMotion = useReducedMotion();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (saveStatus !== 'saved') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- timestamp the moment the save completed
    setSavedAt(new Date().toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }));
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 1000);
    return () => clearTimeout(timer);
  }, [saveStatus, language]);

  if (saveStatus === 'idle') return null;

  const isError = saveStatus === 'error';
  const opacity = isError || flash ? 'opacity-100' : isZenActive ? 'opacity-40' : 'opacity-70';

  return (
    <div
      data-testid="save-status"
      className={cn(
        'font-mono text-label tracking-widest uppercase whitespace-nowrap transition-opacity duration-300',
        reducedMotion && 'duration-0',
        opacity,
        isError ? 'text-accent-danger' : saveStatus === 'cloud-stale' ? 'text-accent-warning' : 'text-text-main',
      )}
      aria-live="polite"
    >
      <AnimatePresence mode="wait" initial={false}>
        {saveStatus === 'saving' && (
          <motion.span
            key="saving"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {t('editor_saving')}
          </motion.span>
        )}
        {saveStatus === 'saved' && (
          <motion.span
            key="saved"
            className="flex items-center gap-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.3 }}
          >
            <motion.svg viewBox="0 0 12 10" width={12} height={10} aria-hidden="true">
              <motion.path
                d="M1 5 L4.5 8.5 L11 1"
                stroke="currentColor"
                strokeWidth={1.5}
                fill="none"
                strokeLinecap="round"
                initial={{ pathLength: reducedMotion ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: reducedMotion ? 0 : 0.4, ease: 'easeOut' }}
              />
            </motion.svg>
            {savedAt ? `${t('editor_saved')} · ${savedAt}` : t('editor_saved')}
          </motion.span>
        )}
        {saveStatus === 'cloud-stale' && (
          <motion.span
            key="cloud-stale"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.3 }}
          >
            {t('editor_cloud_stale')}
          </motion.span>
        )}
        {saveStatus === 'error' && (
          <motion.span
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.3 }}
          >
            {saveErrorKind === 'quota' ? t('editor_error_quota') : t('editor_error_save')}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
