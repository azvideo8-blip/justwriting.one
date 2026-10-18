import { memo, useRef, useState } from 'react';
import { format, Locale } from 'date-fns';
import { Trash2, RotateCcw, Clock, MoreHorizontal } from 'lucide-react';
import { motion } from 'motion/react';
import { ArchiveSession } from '../types';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { ModalShell, SheetTitle } from '../../../shared/components/ModalShell';
import { EmptyState } from '../../../shared/components/EmptyState';
import { cn } from '../../../core/utils/utils';

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

function getDaysRemaining(trashedAt?: number): number {
  if (!trashedAt) return 10;
  const elapsed = Date.now() - trashedAt;
  const remaining = TEN_DAYS_MS - elapsed;
  if (remaining <= 0) return 0;
  return Math.max(1, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}

function formatDaysLeft(days: number, t: (key: string, args?: Record<string, string | number>) => string): string {
  if (days === 1) return t('archive_trash_days_left_one', { days });
  if (days >= 2 && days <= 4) return t('archive_trash_days_left_few', { days });
  return t('archive_trash_days_left_many', { days });
}

function rowTitle(session: ArchiveSession, t: (key: string) => string): string {
  return session.title?.trim()
    || (session.content ? session.content.split('\n').map(l => l.trim()).find(l => l.length > 0) : undefined)
    || (!session._isLocal && session._hasCloudCopy ? t('archive_cloud_only_note') : t('session_untitled'));
}

interface ArchiveTrashViewProps {
  trashedSessions: ArchiveSession[];
  onRestore: (session: ArchiveSession) => Promise<void>;
  onDeletePermanently: (session: ArchiveSession) => void;
  onEmptyTrash: () => void;
  onOpenPreview?: (session: ArchiveSession) => void;
  dateLocale?: Locale;
  t: (key: string, args?: Record<string, string | number>) => string;
  /** D-8: счётчик записей в корзине склоняется — `archive_count_one/_few/_many` уже в словарях.
   *  B-5: тем же `tp` считается и число слов, иначе ряд печатал «3 всего слов». */
  tp: (key: string, count: number) => string;
  /** MR-10: на телефоне строки компактные, а действия — под «⋯». */
  isMobile?: boolean;
}

/**
 * MR-10: мобильная строка корзины — 64 px, как ряд заметок: заголовок слева,
 * «осталось N дней» справа, действия в листе (по «⋯» или долгому нажатию).
 * Десктопная карточка с двумя кнопками на телефоне давала 190 px на запись.
 */
function MobileTrashRow({
  session, daysLeft, onOpenPreview, onRestore, onDeletePermanently, t, tp,
}: {
  session: ArchiveSession;
  daysLeft: number;
  onOpenPreview?: (session: ArchiveSession) => void;
  onRestore: (session: ArchiveSession) => Promise<void>;
  onDeletePermanently: (session: ArchiveSession) => void;
  t: ArchiveTrashViewProps['t'];
  tp: ArchiveTrashViewProps['tp'];
}) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const titleId = `trash-row-menu-${session.id}`;

  const startPress = () => {
    longPressFired.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      longPressFired.current = true;
      setOpen(true);
    }, 500);
  };

  const cancelPress = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const openFromTap = () => {
    if (longPressFired.current) { longPressFired.current = false; return; }
    onOpenPreview?.(session);
  };

  return (
    <div
      className="flex items-center gap-3 h-16 px-3 border-b border-border-subtle last:border-b-0"
      onTouchStart={startPress}
      onTouchMove={cancelPress}
      onTouchEnd={cancelPress}
    >
      <div className="flex-1 min-w-0 cursor-pointer" onClick={openFromTap}>
        <div className="text-[15px] text-text-main truncate">{rowTitle(session, t)}</div>
        <div className="text-[12px] text-text-main/50 truncate">
          {formatDaysLeft(daysLeft, t)}
          {session.wordCount > 0 && ` · ${session.wordCount} ${tp('archive_stat_words', session.wordCount)}`}
        </div>
      </div>
      <IconButton
        onClick={() => setOpen(true)}
        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg text-text-main/60"
        label={t('archive_note_actions')}
        icon={<MoreHorizontal size={20} aria-hidden="true" />}
      />
      {open && (
        <ModalShell open={open} onClose={() => setOpen(false)} labelId={titleId} variant="sheet">
          <div className="flex flex-col min-h-0 flex-1">
            <div className="px-4 pt-4 pb-2">
              <SheetTitle id={titleId}>{rowTitle(session, t)}</SheetTitle>
            </div>
            <button
              type="button"
              className="w-full h-12 flex items-center gap-3 px-4 text-left text-sm text-text-main border-b border-border-subtle"
              onClick={() => { setOpen(false); void onRestore(session); }}
            >
              <RotateCcw size={16} aria-hidden="true" />
              <span className="flex-1">{t('archive_trash_restore')}</span>
            </button>
            <button
              type="button"
              className="w-full h-12 flex items-center gap-3 px-4 text-left text-sm text-accent-danger"
              onClick={() => { setOpen(false); onDeletePermanently(session); }}
            >
              <Trash2 size={16} aria-hidden="true" />
              <span className="flex-1">{t('archive_trash_delete_forever')}</span>
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

export const ArchiveTrashView = memo(function ArchiveTrashView({
  trashedSessions,
  onRestore,
  onDeletePermanently,
  onEmptyTrash,
  onOpenPreview,
  dateLocale,
  t,
  tp,
  isMobile = false,
}: ArchiveTrashViewProps) {
  if (trashedSessions.length === 0) {
    return (
      <div className="py-12">
        <EmptyState
          icon={Trash2}
          title={t('archive_trash_empty')}
          description={t('archive_trash_empty_desc')}
        />
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="flex flex-col py-2">
        <div className="flex items-center px-3 pb-2 text-sm text-text-main/60">
          {trashedSessions.length} {tp('archive_count', trashedSessions.length)}
        </div>
        <div className="flex flex-col overflow-y-auto">
          {trashedSessions.map(session => (
            <MobileTrashRow
              key={session.id}
              session={session}
              daysLeft={getDaysRemaining(session.trashedAt)}
              {...(onOpenPreview ? { onOpenPreview } : {})}
              onRestore={onRestore}
              onDeletePermanently={onDeletePermanently}
              t={t}
              tp={tp}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex items-center justify-between pb-2 border-b border-[var(--color-border-subtle)]">
        <span className="text-sm text-text-main/60">
          {trashedSessions.length} {tp('archive_count', trashedSessions.length)}
        </span>
        <Button
          onClick={onEmptyTrash}
          className="h-8 px-3 rounded-lg flex items-center gap-1.5 text-xs font-medium border border-accent-danger/30 text-accent-danger hover:bg-accent-danger/10 transition-colors"
        >
          <Trash2 size={13} aria-hidden="true" />
          <span>{t('archive_trash_clear')}</span>
        </Button>
      </div>

      <div className="flex flex-col gap-2.5 overflow-y-auto">
        {trashedSessions.map(session => {
          const daysLeft = getDaysRemaining(session.trashedAt);
          const trashedDate = session.trashedAt
            ? format(new Date(session.trashedAt), 'd MMM yyyy, HH:mm', dateLocale ? { locale: dateLocale } : undefined)
            : '';

          return (
            <motion.div
              key={session.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="group p-4 rounded-xl bg-surface-card/40 border border-border-subtle hover:border-border-subtle/80 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => onOpenPreview?.(session)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-base font-medium text-text-main truncate">
                    {rowTitle(session, t)}
                  </h3>
                  <div
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono shrink-0",
                      daysLeft <= 2
                        ? "bg-accent-danger/15 text-accent-danger border border-accent-danger/30"
                        : "bg-text-main/[0.06] text-text-main/70 border border-border-subtle"
                    )}
                    title={t('session_delete_confirm_desc')}
                  >
                    <Clock size={11} aria-hidden="true" />
                    <span>{formatDaysLeft(daysLeft, t)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-text-main/50">
                  {!session._isLocal && session._hasCloudCopy && (
                    <span className="text-brand-soft font-medium">{t('archive_cloud_only')}</span>
                  )}
                  {session.wordCount > 0 && (
                    <span>{session.wordCount} {tp('archive_stat_words', session.wordCount)}</span>
                  )}
                  {trashedDate && (
                    <span>• {trashedDate}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    void onRestore(session);
                  }}
                  className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium bg-text-main/[0.04] border border-border-subtle text-text-main/80 hover:text-text-main hover:bg-text-main/[0.08] transition-colors"
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  <span>{t('archive_trash_restore')}</span>
                </Button>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeletePermanently(session);
                  }}
                  className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium border border-accent-danger/20 text-accent-danger/80 hover:text-accent-danger hover:bg-accent-danger/10 transition-colors"
                >
                  <Trash2 size={13} aria-hidden="true" />
                  <span>{t('archive_trash_delete_forever')}</span>
                </Button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
});
