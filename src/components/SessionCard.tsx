import React, { useState } from 'react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import { 
  Clock, Type, PenLine, Globe, Lock, Share2, 
  ChevronDown, ChevronUp, X, User as UserIcon 
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Session } from '../types';
import { parseFirestoreDate, cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

export function SessionCard({ session, showAuthor }: { session: Session, showAuthor?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(session.content);
  const [editTitle, setEditTitle] = useState(session.title || '');
  const [editTags, setEditTags] = useState<string[]>(session.tags || []);
  const [editIsPublic, setEditIsPublic] = useState(session.isPublic);
  const [tagInput, setTagInput] = useState('');

  const handleSave = async () => {
    try {
      await updateDoc(doc(db, 'sessions', session.id), {
        content: editContent,
        title: editTitle,
        tags: editTags,
        isPublic: editIsPublic,
        wordCount: editContent.trim().split(/\s+/).filter(x => x.length > 3).length,
        charCount: editContent.length
      });
      setIsEditing(false);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `sessions/${session.id}`);
    }
  };

  const exportToTxt = (text: string) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session_${format(parseFirestoreDate(session.createdAt), 'yyyy-MM-dd_HH-mm')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addTag = () => {
    if (tagInput.trim() && !editTags.includes(tagInput.trim())) {
      setEditTags([...editTags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const removeTag = (t: string) => {
    setEditTags(editTags.filter(tag => tag !== t));
  };

  const sessionDate = parseFirestoreDate(session.createdAt);

  return (
    <motion.div 
      layout
      className="bg-white dark:bg-stone-900 p-6 md:p-8 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm hover:shadow-md transition-all space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {showAuthor && (
            <div className="w-8 h-8 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center overflow-hidden border border-stone-100 dark:border-stone-800">
              {session.authorPhoto ? (
                <img src={session.authorPhoto} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon size={14} className="text-stone-400" />
              )}
            </div>
          )}
          <div className="flex flex-col">
            <span className="text-[10px] md:text-xs font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">
              {format(new Date(sessionDate), 'd MMM yyyy • HH:mm')}
            </span>
            {showAuthor && <span className="font-medium text-stone-900 dark:text-stone-100">{session.isAnonymous ? 'Аноним' : (session.nickname || session.authorName)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-4 text-stone-400 dark:text-stone-500 text-xs md:text-sm font-mono">
          <span className="flex items-center gap-1" title="Время"><Clock size={14} /> {Math.floor(session.duration / 60)}м</span>
          <span className="flex items-center gap-1" title="Слова"><Type size={14} /> {session.wordCount}сл</span>
          <span className="flex items-center gap-1" title="Символы"><PenLine size={14} /> {session.charCount || 0}</span>
          {session.isPublic ? <Globe size={14} /> : <Lock size={14} />}
          <div className="flex items-center gap-1 ml-2">
            <button 
              onClick={() => exportToTxt(session.content)}
              className="p-1 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
              title="Экспорт .txt"
            >
              <Share2 size={16} />
            </button>
            {!showAuthor && auth.currentUser?.uid === session.userId && (
              <button 
                onClick={() => setIsEditing(!isEditing)}
                className="p-1 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
              >
                <PenLine size={16} />
              </button>
            )}
            <button 
              onClick={() => setExpanded(!expanded)}
              className="p-1 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
            >
              {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          </div>
        </div>
      </div>

      {session.title && !isEditing && (
        <h4 className="text-xl font-bold dark:text-stone-100">{session.title}</h4>
      )}

      {isEditing ? (
        <div className="space-y-4">
          <input 
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Заголовок..."
            className="w-full px-4 py-2 bg-stone-50 dark:bg-stone-950 rounded-xl border border-stone-200 dark:border-stone-800 outline-none focus:border-stone-400 transition-all dark:text-stone-100 font-bold"
          />
          <textarea 
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full min-h-[200px] p-4 bg-stone-50 dark:bg-stone-950 rounded-2xl border border-stone-200 dark:border-stone-800 outline-none focus:border-stone-400 transition-all dark:text-stone-100"
          />
          <div className="flex flex-wrap items-center gap-2 p-3 bg-stone-50 dark:bg-stone-950 rounded-xl border border-stone-200 dark:border-stone-800">
            <div className="flex flex-wrap gap-2">
              {editTags.map(tag => (
                <span key={tag} className="flex items-center gap-1 px-2 py-1 bg-stone-200 dark:bg-stone-800 text-stone-600 dark:text-stone-400 rounded-lg text-xs font-medium">
                  #{tag}
                  <button onClick={() => removeTag(tag)} className="hover:text-red-500"><X size={10} /></button>
                </span>
              ))}
            </div>
            <input 
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
              placeholder="Добавить тег..."
              className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm dark:text-stone-100"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editIsPublic} onChange={(e) => setEditIsPublic(e.target.checked)} className="rounded border-stone-300" />
              <span className="text-sm text-stone-500">Публичная заметка</span>
            </label>
            <div className="flex gap-2">
              <button onClick={() => setIsEditing(false)} className="px-4 py-2 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 font-medium">Отмена</button>
              <button onClick={handleSave} className="px-6 py-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 rounded-xl font-bold">Сохранить</button>
            </div>
          </div>
        </div>
      ) : (
        <div className={cn("relative", !expanded && "max-h-24 overflow-hidden")}>
          <p className="text-stone-600 dark:text-stone-300 leading-relaxed whitespace-pre-wrap">
            {session.content}
          </p>
          {!expanded && session.content.length > 200 && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white dark:from-stone-900 to-transparent" />
          )}
        </div>
      )}

      {!isEditing && session.tags && session.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {session.tags.map(tag => (
            <span key={tag} className="text-xs font-medium text-stone-400">#{tag}</span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
