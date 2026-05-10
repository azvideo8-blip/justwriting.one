import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import { Clock, Type, PenLine, ChevronDown, ChevronUp, Trash2, Share2 } from 'lucide-react';
import { auth } from '../../../core/firebase/auth';
import { deleteSession } from '../services/SessionDeleteService';
import { Session, Label } from '../../../types';
import { parseFirestoreDate, cn } from '../../../core/utils/utils';
import { highlightText } from '../../../shared/utils/highlightText';
import { useLanguage } from '../../../core/i18n';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';

import { SessionEditor } from './SessionEditor';
import { ExportMenu } from './ExportMenu';
import { TagsSection } from './TagsSection';
import { CancelConfirmModal } from '../../../shared/components/CancelConfirmModal';

export function SessionCard({
  session,
  onContinue,
  labels,
  searchQuery = '',
  onDeleteSuccess,
  userId,
  linkedCloudId: _linkedCloudId,
  hasCloudCopy: _hasCloudCopy,
}: {
  session: Session,
  onContinue?: () => void,
  labels?: Label[],
  searchQuery?: string,
  onDeleteSuccess?: (sessionId: string) => void
  userId?: string,
  linkedCloudId?: string,
  hasCloudCopy?: boolean,
}) {
  const { t } = useLanguage();
  const { execute } = useServiceAction();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportButtonRef = useRef<HTMLButtonElement>(null);

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
    execute(
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

  return (
    <>
      <motion.div
        layout
        className="p-6 md:p-8 transition-all space-y-4 group relative bg-surface-card backdrop-blur-xl border border-border-subtle rounded-3xl text-text-main hover:bg-white/10"
      >
        <div className="absolute inset-0 rounded-3xl overflow-hidden pointer-events-none">
          <div className="absolute -top-16 -left-16 w-32 h-32 rounded-full blur-3xl opacity-0 transition-all duration-700 bg-white/5 mix-blend-screen group-hover:opacity-100 group-hover:translate-x-4" />
        </div>
        {label && (
          <div className="flex items-center gap-2 relative z-10">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: label.color }} />
            <span className="text-xs font-bold uppercase tracking-widest text-text-main/50">{label.name}</span>
          </div>
        )}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-[11px] md:text-xs font-bold uppercase tracking-widest text-text-main/40">
                {format(new Date(session.sessionStartTime || (sessionDate.getTime() - session.duration * 1000)), 'd MMM yyyy • HH:mm')}
              </span>
            </div>
          </div>
          <div className="flex items-center flex-wrap gap-3 text-xs md:text-sm font-mono text-text-main/50">
            <span className="flex items-center gap-1" title={t('writing_time')}><Clock size={14} /> {Math.floor(session.duration / 60)}{t('unit_min')}</span>
            <span className="flex items-center gap-1" title={t('writing_words')}><Type size={14} /> {session.wordCount}{t('unit_words')}</span>
            <span className="flex items-center gap-1" title={t('writing_chars')}><PenLine size={14} /> {session.charCount || 0}</span>

            <div className="flex items-center flex-wrap gap-2 relative">
              <button
                ref={exportButtonRef}
                onClick={() => setShowExportMenu(!showExportMenu)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all",
                  showExportMenu
                    ? "bg-text-main text-surface-base"
                    : "bg-surface-base text-text-main/70 hover:bg-white/10"
                )}
              >
                <Share2 size={12} />
                {t('session_export')}
              </button>

              {showExportMenu && (
                <ExportMenu
                  session={session}
                  buttonRef={exportButtonRef}
                  onClose={() => setShowExportMenu(false)}
                />
              )}

              {(auth.currentUser?.uid === session.userId || session._isLocal) && (
                <>
                  <button
                    onClick={() => setIsEditing(!isEditing)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all bg-surface-base text-text-main/70 hover:bg-white/10"
                  >
                    <PenLine size={12} />
                    {t('session_edit')}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all hover:text-red-500 bg-surface-base text-text-main/70 hover:bg-white/10"
                  >
                    <Trash2 size={12} />
                    {t('session_delete')}
                  </button>
                </>
              )}

              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all bg-surface-base text-text-main/70 hover:bg-white/10"
              >
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {expanded ? t('session_collapse') : t('session_expand')}
              </button>
            </div>
          </div>
        </div>

        {session.title && !isEditing && (
          <h4 className="text-xl font-bold relative z-10 text-text-main">
            {highlightText(session.title, searchQuery)}
          </h4>
        )}

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
              <button
                onClick={onContinue}
                className="flex items-center gap-2 px-6 py-2 rounded-2xl font-bold transition-opacity text-sm bg-text-main text-surface-base hover:opacity-90"
              >
                <PenLine size={16} />
                {t('session_continue')}
              </button>
            )}
          </div>
        )}
      </motion.div>
      <CancelConfirmModal
        isOpen={showDeleteConfirm}
        title={t('session_delete_confirm')}
        description={t('session_delete_confirm_desc')}
        confirmLabel={t('session_delete')}
        cancelLabel={t('writing_cancel')}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
