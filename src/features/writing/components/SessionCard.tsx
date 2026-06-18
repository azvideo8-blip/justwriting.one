import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { Clock, Type, PenLine, ChevronDown, ChevronUp, Trash2, Share2, HardDrive, Cloud } from 'lucide-react';
import { auth } from '../../../core/firebase/auth';
import { deleteSession } from '../services/SessionDeleteService';
import { Session, Label } from '../../../types';
import { parseFirestoreDate, cn } from '../../../core/utils/utils';
import { highlightText } from '../../../shared/utils/highlightText';
import { useLanguage } from '../../../shared/i18n';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';

import { SessionEditor } from './SessionEditor';
import { ExportMenu } from './ExportMenu';
import { TagsSection } from './TagsSection';
import { CancelConfirmModal } from '../../../shared/components/CancelConfirmModal';
import { MobileNoteActionsSheet } from '../../archive/components/MobileNoteActionsSheet';
import { Button } from '../../../shared/components/Button';

export const SessionCard = React.memo(function SessionCard({
  session,
  onContinue,
  labels,
  searchQuery = '',
  onDeleteSuccess,
  userId,
  linkedCloudId: _linkedCloudId,
  hasCloudCopy: _hasCloudCopy,
  onPreview,
  onLabelChange,
}: {
  session: Session & {
    _isLocal?: boolean | undefined;
    _linkedCloudId?: string | undefined;
    _hasCloudCopy?: boolean | undefined;
    _hasPendingSync?: boolean | undefined;
  },
  onContinue?: (() => void) | undefined,
  labels?: Label[] | undefined,
  searchQuery?: string | undefined,
  onDeleteSuccess?: ((sessionId: string) => void) | undefined,
  userId?: string | undefined,
  linkedCloudId?: string | undefined,
  hasCloudCopy?: boolean | undefined,
  onPreview?: (() => void) | undefined,
  onLabelChange?: ((session: Session, labelId: string | undefined) => void) | undefined,
}) {
  const { t } = useLanguage();
  const { execute } = useServiceAction();
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode !== 'desktop';
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showActionsSheet, setShowActionsSheet] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerVibration = () => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(60);
      } catch {
        // ignore
      }
    }
  };

  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const swipeOffsetRef = useRef(0); // always up-to-date, avoids stale closure in handleTouchEnd

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isEditing) return;
    const touch = e.touches[0];
    if (!touch) return;
    setTouchStart(touch.clientX);

    if (isMobile && userId && !userId.startsWith('guest_')) {
      longPressTimer.current = setTimeout(() => {
        triggerVibration();
        setShowActionsSheet(true);
      }, 600);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStart === null || isEditing) return;
    const touch = e.touches[0];
    if (!touch) return;
    const current = touch.clientX;
    const diff = current - touchStart;

    if (Math.abs(diff) > 10 && longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    if (diff < 0) {
      swipeOffsetRef.current = diff;
      setSwipeOffset(diff);
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (touchStart === null) return;
    // Use ref to avoid stale closure — check before resetting
    if (swipeOffsetRef.current < -150) {
      triggerVibration();
      setShowDeleteConfirm(true);
    }
    swipeOffsetRef.current = 0;
    setTouchStart(null);
    setSwipeOffset(0);
  };

  React.useEffect(() => {
    if (searchQuery && (
      session.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      session.title?.toLowerCase().includes(searchQuery.toLowerCase())
    )) {
      setExpanded(true);
    }
  }, [searchQuery, session.content, session.title]);

  const label = labels?.find(l => l.id === session.labelId);

  const handleDelete = () => {
    void execute(
      () => deleteSession(userId || '', session),
      {
        successMessage: t('session_deleted'),
        errorMessage: t('error_delete_failed'),
        onSuccess: () => {
          setShowDeleteConfirm(false);
          if (onDeleteSuccess) onDeleteSuccess(session.id);
        }
      }
    );
  };

  const sessionDate = parseFirestoreDate(session.createdAt);

  const sessionTime = React.useMemo(() => {
    if (session.sessionStartTime) {
      return new Date(session.sessionStartTime);
    }
    const baseTime = sessionDate?.getTime() ?? 0;
    return new Date(baseTime - session.duration * 1000);
  }, [session.sessionStartTime, sessionDate, session.duration]);

  return (
    <>
      <div className="relative overflow-hidden rounded-3xl select-none">
        {/* Red Delete Background */}
        <div 
          className="absolute inset-y-0 right-0 left-0 bg-accent-danger text-white rounded-3xl flex items-center justify-end pr-8 z-0 pointer-events-none transition-opacity"
          style={{ opacity: swipeOffset < -10 ? 1 : 0 }}
        >
          <Trash2 
            size={22} 
            className={cn("transition-transform duration-150", swipeOffset < -150 ? "scale-125" : "scale-100")} 
          />
        </div>

        <motion.div
          layout
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={(e) => {
            if (isEditing) return;
            const target = e.target as HTMLElement;
            if (target.closest('button') || target.closest('a') || target.closest('input')) return;
            if (isMobile) {
              onPreview?.();
            }
          }}
          className="p-6 md:p-8 transition-colors space-y-4 group relative bg-surface-card backdrop-blur-xl border border-border-subtle rounded-3xl text-text-main hover:bg-white/10 z-10 touch-pan-y"
          style={{
            transform: `translate3d(${swipeOffset}px, 0, 0)`,
            transition: touchStart === null ? 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)' : 'none'
          }}
        >
          <div className="absolute inset-0 rounded-3xl overflow-hidden pointer-events-none">
            <div className="absolute -top-16 -left-16 w-32 h-32 rounded-full blur-3xl opacity-0 transition-all duration-700 bg-white/5 mix-blend-screen group-hover:opacity-100 group-hover:translate-x-4" />
          </div>
        {label && (
          <div
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full"
            style={{
              border: `1px solid ${label.color}40`,
              background: `${label.color}0d`,
            }}
          >
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
            <span className="text-label font-bold uppercase tracking-widest" style={{ color: label.color + 'bb' }}>
              {label.name}
            </span>
          </div>
        )}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-label-sm md:text-xs font-bold uppercase tracking-widest text-text-main/60">
                {sessionTime.getTime() > 0 ? format(sessionTime, 'd MMM yyyy • HH:mm') : ''}
              </span>
            </div>
          </div>
          <div className="flex items-center flex-wrap gap-3 text-xs md:text-sm font-mono text-text-main/60">
            <span className="flex items-center gap-1" title={t('writing_time')}><Clock size={14} /> {Math.floor(session.duration / 60)}{t('unit_min')}</span>
            <span className="flex items-center gap-1" title={t('writing_words')}><Type size={14} /> {session.wordCount}{t('unit_words')}</span>
            <span className="flex items-center gap-1" title={t('writing_chars')}><PenLine size={14} /> {session.charCount || 0}</span>

            {/* Storage Status Indicators */}
            {userId && !userId.startsWith('guest_') && (
              <span className="flex items-center gap-1.5 ml-1 border-l border-white/10 pl-2">
                <span title={session._isLocal ? t('storage_local') : t('storage_no_local')}>
                  <HardDrive 
                    size={13} 
                    className={session._isLocal ? "text-text-main/60" : "text-text-main/60"} 
                  />
                </span>
                <span title={session._hasPendingSync ? t('storage_sync_pending') : session._hasCloudCopy ? t('storage_cloud') : t('storage_no_cloud')}>
                  <Cloud 
                    size={13} 
                    className={session._hasPendingSync ? "text-amber-500 animate-pulse" : session._hasCloudCopy ? "text-blue-400" : "text-text-main/60"}
                    style={session._hasPendingSync ? { filter: 'drop-shadow(0 0 5px rgb(245 158 11 / 0.6))' } : undefined}
                  />
                </span>
              </span>
            )}

            <div className="flex items-center flex-wrap gap-2 relative">
              <Button
                variant={showExportMenu ? 'primary' : 'ghost'}
                size="sm"
                ref={exportButtonRef}
                onClick={() => setShowExportMenu(!showExportMenu)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-label-sm font-bold uppercase tracking-wider",
                  showExportMenu
                    ? "bg-text-main text-surface-base"
                    : "bg-surface-base text-text-main/70 hover:bg-white/10"
                )}
              >
                <Share2 size={12} />
                {t('session_export')}
              </Button>

              {showExportMenu && (
                <ExportMenu
                  session={session}
                  buttonRef={exportButtonRef}
                  onClose={() => setShowExportMenu(false)}
                />
              )}

              {(auth.currentUser?.uid === session.userId || session._isLocal) && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditing(!isEditing)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-label-sm font-bold uppercase tracking-wider bg-surface-base text-text-main/70 hover:bg-white/10"
                  >
                    <PenLine size={12} />
                    {t('session_edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-label-sm font-bold uppercase tracking-wider hover:text-accent-danger bg-surface-base text-text-main/70 hover:bg-white/10"
                  >
                    <Trash2 size={12} />
                    {t('session_delete')}
                  </Button>
                </>
              )}

              {!isMobile && session.content.length > 200 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-label-sm font-bold uppercase tracking-wider bg-surface-base text-text-main/70 hover:bg-white/10"
                >
                  {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {expanded ? t('session_collapse') : t('session_expand')}
                </Button>
              )}
            </div>
          </div>
        </div>

        {session.title && !isEditing ? (
          <h4 className="text-xl font-bold relative z-10 text-text-main flex items-center gap-2">
            {session.mood && <span className="text-2xl shrink-0" title={`Mood: ${session.mood}`}>{session.mood}</span>}
            {highlightText(session.title, searchQuery)}
          </h4>
        ) : !isEditing && session.mood ? (
          <div className="flex items-center gap-2 relative z-10 text-2xl" title={`Mood: ${session.mood}`}>
            {session.mood}
          </div>
        ) : null}

        {isEditing ? (
          <SessionEditor
            session={session}
            onCancel={() => setIsEditing(false)}
            onSave={() => setIsEditing(false)}
          />
        ) : (
          <div className={cn("relative z-10", !expanded && "max-h-24 overflow-hidden")}>
            <p className="leading-relaxed whitespace-pre-wrap text-text-main/80">
              {highlightText(session.content, searchQuery)}
            </p>
            {!expanded && session.content.length > 200 && (
              <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-surface-card/80 to-transparent" />
            )}
          </div>
        )}

        {!isEditing && (
          <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t relative z-10 border-border-subtle">
            <TagsSection session={session} isEditing={isEditing} />
            {onContinue && (auth.currentUser?.uid === session.userId || session._isLocal) && (
              <Button
                variant="primary"
                size="md"
                onClick={onContinue}
                className="flex items-center gap-2 px-6 py-2 rounded-2xl font-bold text-sm"
              >
                <PenLine size={16} />
                {t('session_continue')}
              </Button>
            )}
          </div>
        )}
      </motion.div>
      </div>
      <CancelConfirmModal
        isOpen={showDeleteConfirm}
        title={t('session_delete_confirm')}
        description={t('session_delete_confirm_desc')}
        confirmLabel={t('session_delete')}
        cancelLabel={t('writing_cancel')}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
      <AnimatePresence>
        {showActionsSheet && (
          <MobileNoteActionsSheet
            isOpen={showActionsSheet}
            onClose={() => setShowActionsSheet(false)}
            session={{
              id: session.id,
              title: session.title,
              labelId: session.labelId,
              _isLocal: session._isLocal,
              _linkedCloudId: session._linkedCloudId,
              _hasCloudCopy: session._hasCloudCopy,
              _hasPendingSync: session._hasPendingSync,
            }}
            userId={userId || ''}
            labels={labels}
            onOpen={() => onPreview?.()}
            onRename={() => setIsEditing(true)}
            onDelete={() => setShowDeleteConfirm(true)}
            onLabelChange={(labelId) => onLabelChange?.(session, labelId)}
            onStorageChange={() => {
              if (onDeleteSuccess) onDeleteSuccess(session.id);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
});
