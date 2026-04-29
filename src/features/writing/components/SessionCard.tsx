import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import { 
  Clock, Type, PenLine, Share2, 
  ChevronDown, ChevronUp, X,
  FileText, Download, FileJson, Plus, Trash2, Cloud, HardDrive
} from 'lucide-react';
import { auth } from '../../../core/firebase/auth';
import { SessionService } from '../services/SessionService';
import { StorageService } from '../services/StorageService';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { Session, Label } from '../../../types';
import { parseFirestoreDate, cn } from '../../../core/utils/utils';
import { ExportService } from '../../export/ExportService';
import { useLanguage } from '../../../core/i18n';
import { useServiceAction } from '../hooks/useServiceAction';
import { useSessionTags } from '../hooks/useSessionTags';

import { SessionEditor } from './SessionEditor';
import { CancelConfirmModal } from './modals/CancelConfirmModal';

export function SessionCard({ 
  session, 
  onContinue, 
  labels,
  searchQuery = '',
  onDeleteSuccess,
  userId,
  linkedCloudId,
  hasCloudCopy,
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
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [exportMenuPos, setExportMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const { tags, addTag, removeTag } = useSessionTags(session.id, session.tags || []);

  const handleExportToggle = () => {
    if (!showExportMenu && exportButtonRef.current) {
      const rect = exportButtonRef.current.getBoundingClientRect();
      setExportMenuPos({
        top: rect.bottom + window.scrollY + 8,
        right: window.innerWidth - rect.right
      });
    }
    setShowExportMenu(!showExportMenu);
  };

  useEffect(() => {
    if (!showExportMenu) return;
    const handleClickOutside = (e: PointerEvent) => {
      const clickedButton = exportButtonRef.current?.contains(e.target as Node);
      const clickedMenu = exportMenuRef.current?.contains(e.target as Node);
      if (!clickedButton && !clickedMenu) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('pointerup', handleClickOutside);
    return () => document.removeEventListener('pointerup', handleClickOutside);
  }, [showExportMenu]);

  // Auto-expand on search match
  React.useEffect(() => {
    if (searchQuery && (
      session.content.toLowerCase().includes(searchQuery.toLowerCase()) || 
      session.title?.toLowerCase().includes(searchQuery.toLowerCase())
    )) {
      setExpanded(true);
    }
  }, [searchQuery, session.content, session.title]);

  const label = labels?.find(l => l.id === session.labelId);

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const tag = newTag.trim().toLowerCase();
    if (tag) {
      addTag(tag);
      setNewTag('');
      setIsAddingTag(false);
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    removeTag(tagToRemove);
  };

  const highlightText = (text: string, query: string) => {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return (
      <>
        {parts.map((part, i) => 
          part.toLowerCase() === query.toLowerCase() ? (
            <mark key={i} className="px-0.5 rounded bg-text-main/20 text-text-main">
              {part}
            </mark>
          ) : part
        )}
      </>
    );
  };

  const handleDelete = () => {
    execute(
      async () => {
        if (session._isLocal) {
          const doc = await LocalDocumentService.getDocument(session.id);
          const cloudId = doc?.linkedCloudId || linkedCloudId;
          await StorageService.deleteDocument(userId || '', session.id, cloudId || undefined);
        } else {
          await SessionService.deleteSession(session.id);
        }
      },
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

  const exportToTxt = () => {
    ExportService.toTxt(session.title || 'session', session.content, parseFirestoreDate(session.createdAt));
    setShowExportMenu(false);
  };

  const exportPDF = () => {
    ExportService.toPDF(session.title || 'Untitled Session', session.content);
    setShowExportMenu(false);
  };

  const exportMarkdown = () => {
    ExportService.toMarkdown(session.title || 'Untitled Session', session.content);
    setShowExportMenu(false);
  };

  const exportDocx = () => {
    execute(
      () => ExportService.toDocx(session.title || 'Untitled Session', session.content),
      { errorMessage: t('error_export_failed') }
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

            {session._isLocal && (
              <span title={t('storage_local')} className="flex items-center gap-1"><HardDrive size={14} className="text-text-main/30" /></span>
            )}
            {(hasCloudCopy || (!session._isLocal && session.id && !session.id.startsWith('local_'))) && (
              <span title={t('storage_cloud')} className="flex items-center gap-1"><Cloud size={14} className="text-blue-400/50" /></span>
            )}

            <div className="flex items-center flex-wrap gap-2 relative">
              <button 
                ref={exportButtonRef}
                onClick={handleExportToggle}
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

              {showExportMenu && exportMenuPos && createPortal(
                <motion.div 
                  ref={exportMenuRef}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  style={{
                    position: 'fixed',
                    top: exportMenuPos.top,
                    right: exportMenuPos.right,
                    zIndex: 9999
                  }}
                  className={cn(
                    "w-48 rounded-2xl shadow-xl border p-2 bg-surface-card backdrop-blur-xl border-border-subtle"
                  )}
                >
                  <button onClick={exportToTxt} className="w-full flex items-center gap-3 px-4 py-2 text-xs font-bold rounded-2xl transition-all text-text-main/70 hover:bg-white/10 hover:text-text-main">
                    <FileText size={14} /> {t('export_txt')}
                  </button>
                  <button onClick={exportPDF} className="w-full flex items-center gap-3 px-4 py-2 text-xs font-bold rounded-2xl transition-all text-text-main/70 hover:bg-white/10 hover:text-text-main">
                    <FileText size={14} className="text-red-500" /> {t('export_pdf')}
                  </button>
                  <button onClick={exportMarkdown} className="w-full flex items-center gap-3 px-4 py-2 text-xs font-bold rounded-2xl transition-all text-text-main/70 hover:bg-white/10 hover:text-text-main">
                    <FileJson size={14} className="text-blue-500" /> {t('export_md')}
                  </button>
                  <button onClick={exportDocx} className="w-full flex items-center gap-3 px-4 py-2 text-xs font-bold rounded-2xl transition-all text-text-main/70 hover:bg-white/10 hover:text-text-main">
                    <Download size={14} className="text-emerald-500" /> {t('export_docx')}
                  </button>
                </motion.div>,
                document.body
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
            <div className="flex flex-wrap items-center gap-2">
              {tags && tags.length > 0 ? (
                tags.map(tag => (
                  <span 
                    key={tag} 
                    className="group/tag flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all bg-surface-base text-text-main/50 hover:bg-white/10"
                  >
                    #{tag}
                    {auth.currentUser?.uid === session.userId && (
                      <button 
                        onClick={() => handleRemoveTag(tag)}
                        className="opacity-0 group-hover/tag:opacity-100 hover:text-red-500 transition-all"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </span>
                ))
              ) : (
                <button 
                  onClick={() => setIsAddingTag(true)}
                  className="text-xs italic transition-colors text-text-main/40 hover:text-text-main/50"
                >
                  + {t('session_add_tags')}
                </button>
              )}

              {isAddingTag ? (
                <form onSubmit={handleAddTag} className="flex items-center gap-1">
                  <input 
                    autoFocus
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onBlur={() => !newTag && setIsAddingTag(false)}
                    placeholder={t('session_tag_placeholder')}
                    className="w-24 px-2.5 py-1.5 border rounded-lg text-xs outline-none transition-all bg-transparent border-border-subtle text-text-main placeholder-text-main/40 focus:ring-1 focus:ring-text-main/20 focus:border-text-main/40 focus:bg-white/5"
                  />
                </form>
              ) : session.tags && session.tags.length > 0 && (
                <button 
                  onClick={() => setIsAddingTag(true)}
                  className="p-1 transition-colors text-text-main/40 hover:text-text-main/50"
                >
                  <Plus size={12} />
                </button>
              )}
            </div>
            
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
