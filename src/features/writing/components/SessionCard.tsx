import React, { useState } from 'react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import { 
  Clock, Type, PenLine, Globe, Lock, Share2, 
  ChevronDown, ChevronUp, X, User as UserIcon,
  FileText, Download, FileJson, Tag, Plus, Trash2
} from 'lucide-react';
import { auth } from '../../../core/firebase/auth';
import { SessionService } from '../services/SessionService';
import { Session, Label } from '../../../types';
import { parseFirestoreDate, cn } from '../../../core/utils/utils';
import { ExportService } from '../../export/ExportService';
import { useLanguage } from '../../../core/i18n';
import { useUI } from '../../../contexts/UIContext';
import { useSessionTags } from '../hooks/useSessionTags';

import { SessionEditor } from './SessionEditor';

export function SessionCard({ 
  session, 
  showAuthor, 
  onContinue, 
  labels,
  searchQuery = '',
  onDeleteSuccess
}: { 
  session: Session, 
  showAuthor?: boolean, 
  onContinue?: () => void, 
  labels?: Label[],
  searchQuery?: string,
  onDeleteSuccess?: (sessionId: string) => void
}) {
  const { t } = useLanguage();
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const { tags, addTag, removeTag } = useSessionTags(session.id, session.tags || []);

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
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return (
      <>
        {parts.map((part, i) => 
          part.toLowerCase() === query.toLowerCase() ? (
            <mark key={i} className={cn("px-0.5 rounded", isV2 ? "bg-white/20 text-white" : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-100")}>
              {part}
            </mark>
          ) : part
        )}
      </>
    );
  };

  const handleDelete = async () => {
    try {
      console.log('SessionCard: Attempting to delete session:', session.id);
      await SessionService.deleteSession(session.id);
      console.log('SessionCard: Session deleted successfully:', session.id);
      setShowDeleteConfirm(false);
      if (onDeleteSuccess) {
        onDeleteSuccess(session.id);
      }
    } catch (e) {
      console.error('SessionCard: Delete error for session', session.id, ':', e);
    }
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

  const exportDocx = async () => {
    await ExportService.toDocx(session.title || 'Untitled Session', session.content);
    setShowExportMenu(false);
  };

  const sessionDate = parseFirestoreDate(session.createdAt);

  return (
    <>
      <motion.div 
        layout
        className={cn(
          "p-6 md:p-8 transition-all space-y-4 group relative overflow-hidden",
          isV2 
            ? "bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl text-[#E5E5E0] hover:bg-white/10" 
            : "bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm hover:shadow-md"
        )}
      >
        {isV2 && (
          <div className="absolute -top-16 -left-16 w-32 h-32 rounded-full blur-3xl opacity-0 transition-all duration-700 bg-white/5 mix-blend-screen group-hover:opacity-100 group-hover:translate-x-4" />
        )}
        {label && (
          <div className="flex items-center gap-2 relative z-10">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: label.color }} />
            <span className={cn("text-xs font-bold uppercase tracking-widest", isV2 ? "text-white/50" : "text-stone-500")}>{label.name}</span>
          </div>
        )}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3">
            {showAuthor && (
              <div className={cn("w-8 h-8 rounded-full flex items-center justify-center overflow-hidden border", isV2 ? "bg-white/10 border-white/10" : "bg-stone-100 dark:bg-stone-800 border-stone-100 dark:border-stone-800")}>
                {session.authorPhoto ? (
                  <img src={session.authorPhoto} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <UserIcon size={14} className={isV2 ? "text-white/50" : "text-stone-400"} />
                )}
              </div>
            )}
            <div className="flex flex-col">
              <span className={cn("text-[10px] md:text-xs font-bold uppercase tracking-widest", isV2 ? "text-white/40" : "text-stone-400 dark:text-stone-500")}>
                {format(new Date(session.sessionStartTime || (sessionDate.getTime() - session.duration * 1000)), 'd MMM yyyy • HH:mm')}
              </span>
              {showAuthor && <span className={cn("font-medium", isV2 ? "text-white" : "text-stone-900 dark:text-stone-100")}>{session.isAnonymous ? t('session_anonymous') : (session.nickname || session.authorName)}</span>}
            </div>
          </div>
          <div className={cn("flex items-center flex-wrap gap-3 text-xs md:text-sm font-mono", isV2 ? "text-white/50" : "text-stone-400 dark:text-stone-500")}>
            <span className="flex items-center gap-1" title={t('writing_time')}><Clock size={14} /> {Math.floor(session.duration / 60)}{t('unit_min')}</span>
            <span className="flex items-center gap-1" title={t('writing_words')}><Type size={14} /> {session.wordCount}{t('unit_words')}</span>
            <span className="flex items-center gap-1" title={t('writing_chars')}><PenLine size={14} /> {session.charCount || 0}</span>
            {session.isPublic ? <Globe size={14} /> : <Lock size={14} />}
            
            <div className="flex items-center flex-wrap gap-2 relative">
              <button 
                onClick={() => setShowExportMenu(!showExportMenu)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                  showExportMenu 
                    ? (isV2 ? "bg-white text-black" : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900") 
                    : (isV2 ? "bg-white/5 text-white/70 hover:bg-white/10" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700")
                )}
              >
                <Share2 size={12} />
                {t('session_export')}
              </button>

              {showExportMenu && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={cn(
                    "absolute right-0 top-full mt-2 w-48 rounded-2xl shadow-xl border p-2 z-50",
                    isV2 ? "bg-[#0A0A0B]/90 backdrop-blur-xl border-white/10" : "bg-white dark:bg-stone-800 border-stone-100 dark:border-stone-700"
                  )}
                >
                  <button 
                    onClick={exportToTxt}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2 text-xs font-bold rounded-xl transition-all",
                      isV2 ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700"
                    )}
                  >
                    <FileText size={14} />
                    {t('export_txt')}
                  </button>
                  <button 
                    onClick={exportPDF}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2 text-xs font-bold rounded-xl transition-all",
                      isV2 ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700"
                    )}
                  >
                    <FileText size={14} className="text-red-500" />
                    {t('export_pdf')}
                  </button>
                  <button 
                    onClick={exportMarkdown}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2 text-xs font-bold rounded-xl transition-all",
                      isV2 ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700"
                    )}
                  >
                    <FileJson size={14} className="text-blue-500" />
                    {t('export_md')}
                  </button>
                  <button 
                    onClick={exportDocx}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2 text-xs font-bold rounded-xl transition-all",
                      isV2 ? "text-white/70 hover:bg-white/10 hover:text-white" : "text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700"
                    )}
                  >
                    <Download size={14} className="text-emerald-500" />
                    {t('export_docx')}
                  </button>
                </motion.div>
              )}

              {!showAuthor && auth.currentUser?.uid === session.userId && (
                <>
                  <button 
                    onClick={() => setIsEditing(!isEditing)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                      isV2 ? "bg-white/5 text-white/70 hover:bg-white/10" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
                    )}
                  >
                    <PenLine size={12} />
                    {t('session_edit')}
                  </button>
                  <button 
                    onClick={() => setShowDeleteConfirm(true)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all hover:text-red-500",
                      isV2 ? "bg-white/5 text-white/70 hover:bg-white/10" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
                    )}
                  >
                    <Trash2 size={12} />
                    {t('session_delete')}
                  </button>
                </>
              )}
              
              <button 
                onClick={() => setExpanded(!expanded)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                  isV2 ? "bg-white/5 text-white/70 hover:bg-white/10" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700"
                )}
              >
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {expanded ? t('session_collapse') : t('session_expand')}
              </button>
            </div>
          </div>
        </div>

        {session.title && !isEditing && (
          <h4 className={cn("text-xl font-bold relative z-10", isV2 ? "text-white" : "dark:text-stone-100")}>
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
            <p className={cn("leading-relaxed whitespace-pre-wrap", isV2 ? "text-white/80" : "text-stone-600 dark:text-stone-300")}>
              {highlightText(session.content, searchQuery)}
            </p>
            {!expanded && session.content.length > 200 && (
              <div className={cn(
                "absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t",
                isV2 ? "from-[#0A0A0B]/80 to-transparent" : "from-white dark:from-stone-900 to-transparent"
              )} />
            )}
          </div>
        )}

        {!isEditing && (
          <div className={cn("flex flex-wrap items-center justify-between gap-4 pt-4 border-t relative z-10", isV2 ? "border-white/10" : "border-stone-100 dark:border-stone-800")}>
            <div className="flex flex-wrap items-center gap-2">
              {tags && tags.length > 0 ? (
                tags.map(tag => (
                  <span 
                    key={tag} 
                    className={cn(
                      "group/tag flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all",
                      isV2 ? "bg-white/5 text-white/50 hover:bg-white/10" : "bg-stone-50 dark:bg-stone-800 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700"
                    )}
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
                  className={cn("text-xs italic transition-colors", isV2 ? "text-white/30 hover:text-white/50" : "text-stone-300 dark:text-stone-600 hover:text-stone-500")}
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
                    className={cn(
                      "w-24 px-2.5 py-1.5 border rounded-lg text-xs outline-none transition-all",
                      isV2 
                        ? "bg-transparent border-white/20 text-white placeholder-white/30 focus:ring-1 focus:ring-white/20 focus:border-white/30 focus:bg-white/5" 
                        : "bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700"
                    )}
                  />
                </form>
              ) : session.tags && session.tags.length > 0 && (
                <button 
                  onClick={() => setIsAddingTag(true)}
                  className={cn("p-1 transition-colors", isV2 ? "text-white/30 hover:text-white/50" : "text-stone-300 hover:text-stone-500")}
                >
                  <Plus size={12} />
                </button>
              )}
            </div>
            
            {onContinue && auth.currentUser?.uid === session.userId && (
              <button 
                onClick={onContinue}
                className={cn(
                  "flex items-center gap-2 px-6 py-2 rounded-xl font-bold transition-opacity text-sm",
                  isV2 ? "bg-white text-black hover:bg-white/90" : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90"
                )}
              >
                <PenLine size={16} />
                {t('session_continue')}
              </button>
            )}
          </div>
        )}
      </motion.div>
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className={cn("p-6 rounded-3xl shadow-xl border", isV2 ? "bg-[#0A0A0B] border-white/10" : "bg-white dark:bg-stone-900 border-stone-200")}>
            <h3 className={cn("text-lg font-bold mb-4", isV2 ? "text-white" : "text-stone-900 dark:text-stone-100")}>{t('session_delete_confirm')}</h3>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className={cn("px-4 py-2 rounded-lg font-bold", isV2 ? "bg-white/10 text-white" : "bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300")}>{t('writing_cancel')}</button>
              <button onClick={handleDelete} className="px-4 py-2 rounded-lg font-bold bg-red-500 text-white">{t('session_delete')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
