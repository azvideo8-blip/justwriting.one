import React, { useState, useRef, memo } from 'react';
import { motion } from 'motion/react';
import { formatDistanceToNow } from 'date-fns';
import { Lock, AlertCircle, MoreHorizontal } from 'lucide-react';
import { ArchiveSession } from '../types';
import { Label } from '../../../types';
import { getDateLocale, formatDateTimeLabel } from '../../../core/utils/dateUtils';
import { highlightText } from '../../../shared/utils/highlightText';
import { InlineTags } from './InlineTags';
import { useLanguage } from '../../../shared/i18n';
import { IconButton } from '../../../shared/components/IconButton';
import { Menu } from '../../../shared/components/Menu';
import { useConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { StorageButtons } from './StorageButtons';
import { useNoteMenu } from './useNoteMenu';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { MobileNoteActionsSheet } from '../../../app/components/MobileNoteActionsSheet';

interface GridNoteCardProps {
  session: ArchiveSession;
  onClick: () => void;
  userId: string;
  searchQuery?: string | undefined;
  labels?: Label[] | undefined;
  allTags?: string[] | undefined;
  onTagsChange?: ((session: ArchiveSession, tags: string[]) => void) | undefined;
  onLabelChange?: ((session: ArchiveSession, labelId: string | undefined) => void) | undefined;
  onTitleChange?: ((session: ArchiveSession, title: string) => void) | undefined;
  onDelete?: ((session: ArchiveSession) => void) | undefined;
  onStorageChange?: (() => void) | undefined;
  aiProcessed?: boolean | undefined;
  aiLoading?: boolean | undefined;
  onAIClick?: (() => void) | undefined;
  aiExclusionLoading?: boolean | undefined;
  onAIExclusionClick?: (() => void) | undefined;
}

// Карточка показывает то же, что строка списка: полосу метки, цветные иконки
// копий и разбора и меню «⋯» (и по правому клику) — владелец видит состояние
// заметки с первого взгляда в обоих видах.
export const GridNoteCard = memo<GridNoteCardProps>(({
  session,
  onClick,
  userId,
  searchQuery = '',
  labels,
  allTags,
  onTagsChange,
  onLabelChange,
  onTitleChange,
  onDelete,
  onStorageChange,
  aiProcessed,
  aiLoading,
  onAIClick,
  aiExclusionLoading,
  onAIExclusionClick,
}) => {
  const { t, tp, language } = useLanguage();
  const { prompt } = useConfirmDialog();
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';
  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const sessionTime = session.sessionStartTime
    ? new Date(session.sessionStartTime)
    : session.createdAt instanceof Date ? session.createdAt : new Date();

  const label = labels?.find(l => l.id === session.labelId);

  const rename = async () => {
    const next = (await prompt({ title: t('archive_rename_title'), defaultValue: session.title ?? '' }))?.trim();
    if (next && next !== session.title) onTitleChange?.(session, next);
  };

  const menu = useNoteMenu({
    session, userId, t, labels, onOpen: onClick,
    onRename: () => { void rename(); },
    onAddTag: () => setTagInputOpen(true),
    onDelete, onLabelChange, onStorageChange,
    aiProcessed, aiLoading, onAIClick, aiExclusionLoading, onAIExclusionClick,
  });

  // DC-A3: та же метка, что в списке — sentence case, одна строка, без mono.
  const formattedDate = formatDateTimeLabel(sessionTime, language);

  const relativeDate = formatDistanceToNow(sessionTime, {
    locale: getDateLocale(language),
    addSuffix: true,
  });

  // MP-2: на телефоне карточка — только текст. Вход в лист действий один:
  // долгое нажатие, тот же порог и то же гашение кликa, что у строки списка.
  const startLongPress = (e: React.TouchEvent) => {
    e.stopPropagation();
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(60);
        } catch {
          // ignore
        }
      }
      longPressFired.current = true;
      setActionsOpen(true);
    }, 500);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleCardTap = () => {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    onClick();
  };

  if (isMobile) {
    return (
      <div
        className="flex h-full min-h-11 cursor-pointer flex-col gap-2 rounded-2xl border border-border-subtle bg-surface-card p-4 active:bg-text-main/[0.04]"
        style={label ? { background: `color-mix(in srgb, ${label.color} 4%, var(--surface-card))` } : undefined}
        onClick={handleCardTap}
        onTouchStart={startLongPress}
        onTouchMove={cancelLongPress}
        onTouchEnd={cancelLongPress}
      >
        {session._locked ? (
          <h4 className="flex items-center gap-1.5 text-[15px] italic leading-snug text-text-main/70">
            <Lock size={15} className="shrink-0 text-accent-warning/80" aria-label={t('archive_note_locked')} />
            <span className="truncate">{t('archive_note_locked')}</span>
          </h4>
        ) : session._decryptionError ? (
          <h4 className="flex items-center gap-1.5 text-[15px] italic leading-snug text-accent-danger/80">
            <AlertCircle size={15} className="shrink-0" aria-label={t('archive_decryption_error')} />
            <span className="truncate">{t('archive_decryption_error')}</span>
          </h4>
        ) : session.title ? (
          <h4 className="line-clamp-2 text-[15px] font-semibold leading-snug text-text-main">
            {highlightText(session.title, searchQuery)}
          </h4>
        ) : null}
        <p className="line-clamp-6 whitespace-pre-wrap text-[14px] leading-[1.45] text-pretty text-text-main/70">
          {highlightText(session.content, searchQuery)}
        </p>

        {actionsOpen && (
          <MobileNoteActionsSheet
            isOpen={actionsOpen}
            onClose={() => setActionsOpen(false)}
            session={session}
            userId={userId}
            labels={labels}
            onOpen={onClick}
            onRename={() => { void rename(); }}
            onDelete={() => onDelete?.(session)}
            onLabelChange={labelId => onLabelChange?.(session, labelId)}
            onStorageChange={() => onStorageChange?.()}
            aiProcessed={aiProcessed}
            aiLoading={aiLoading}
            {...(onAIClick ? { onAIClick } : {})}
            aiExclusionLoading={!!aiExclusionLoading}
            {...(onAIExclusionClick ? { onAIExclusionClick } : {})}
          />
        )}
      </div>
    );
  }

  return (
    <motion.div
      onClick={onClick}
      onContextMenu={e => {
        e.preventDefault();
        menu.setAnchor({ kind: 'point', x: e.clientX, y: e.clientY });
      }}
      whileHover={{ y: -3, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 350, damping: 25 }}
      className="cursor-pointer rounded-2xl p-5 bg-surface-card border border-border-subtle border-l-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-main/30
                 hover:border-text-main/20 hover:bg-text-main/[0.07] hover:shadow-lg transition-colors
                 flex flex-col gap-3 group"
      {...(label ? { style: { borderLeftColor: label.color, background: `color-mix(in srgb, ${label.color} 4%, var(--surface-card))`, boxShadow: `inset 3px 0 8px color-mix(in srgb, ${label.color} 15%, transparent)` } } : {})}
    >
      <div className="text-[13px] font-medium text-text-main/60 tabular-nums">
        {formattedDate}
        <span className="text-text-main/60 ml-1.5">{relativeDate}</span>
      </div>

      {session._locked ? (
        <h4 className="text-[17px] font-semibold text-text-main/70 italic flex items-center gap-1.5 leading-snug">
          <Lock size={15} className="shrink-0 text-accent-warning/80" aria-label={t('archive_note_locked')} />
          <span className="truncate">{t('archive_note_locked')}</span>
        </h4>
      ) : session._decryptionError ? (
        <h4 className="text-[17px] font-semibold text-accent-danger/80 italic flex items-center gap-1.5 leading-snug">
          <AlertCircle size={15} className="shrink-0" aria-label={t('archive_decryption_error')} />
          <span className="truncate">{t('archive_decryption_error')}</span>
        </h4>
      ) : session.title ? (
        <h4 className="text-[17px] font-semibold text-text-main leading-snug">
          {highlightText(session.title, searchQuery)}
        </h4>
      ) : null}

      <div className="relative">
        <p className="text-[14px] leading-relaxed text-text-main/60 line-clamp-4 whitespace-pre-wrap">
          {highlightText(session.content, searchQuery)}
        </p>
      </div>

      <div onClick={e => e.stopPropagation()}>
        <InlineTags
          variant="row"
          tags={session.tags || []}
          allTags={allTags}
          onChange={newTags => onTagsChange?.(session, newTags)}
          isAdding={tagInputOpen}
          onStartAdding={() => setTagInputOpen(true)}
          onStopAdding={() => setTagInputOpen(false)}
        />
      </div>

      <div className="flex items-center gap-2 text-[12px] font-mono text-text-main/60 pt-3 mt-auto border-t border-border-subtle flex-wrap">
        <span>{tp('archive_word_count', session.wordCount)}</span>
        <span className="text-text-main/60">·</span>
        <span>{Math.floor(session.duration / 60)} {t('goal_time_short')}</span>
        {label && (
          <span className="flex items-center gap-1 font-mono text-label-sm text-text-main/60 min-w-0 truncate">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: label.color }} aria-hidden="true" />
            {label.name}
          </span>
        )}
        {/* Иконки копий и разбора и «⋯» — в подвале: в узкой колонке шапка
            сжимала дату в столбик. */}
        <div className="ml-auto flex items-center gap-0.5 -mr-2 -my-1 shrink-0" onClick={e => e.stopPropagation()}>
          <StorageButtons doc={menu.doc} userId={userId} storage={menu.storage} ai={menu.ai} exclusion={menu.exclusion} />
          <IconButton
            size="sm"
            onClick={e => {
              e.stopPropagation();
              const el = e.currentTarget;
              const r = el.getBoundingClientRect();
              menu.setAnchor({ kind: 'trigger', rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, trigger: el });
            }}
            aria-haspopup="menu"
            aria-expanded={menu.anchor !== null}
            className="w-7 h-7 group-hover:text-text-main group-focus-within:text-text-main"
            label={t('archive_note_actions')}
            title={t('archive_note_actions')}
            icon={<MoreHorizontal size={16} aria-hidden="true" />}
          />
        </div>
      </div>

      {/* Меню и диалоги — порталы, но события из них всплывают по дереву React:
          без этой обёртки клик по пункту меню ещё и открывал заметку. */}
      <div onClick={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()} className="contents">
        {menu.anchor !== null && (
          <Menu
            entries={menu.entries}
            anchor={menu.anchor}
            onClose={() => menu.setAnchor(null)}
            label={t('archive_note_actions')}
          />
        )}
        {menu.storage.dialogs}
      </div>
    </motion.div>
  );
});

GridNoteCard.displayName = 'GridNoteCard';
