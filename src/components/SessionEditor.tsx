import React, { useState } from 'react';
import { X } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Session } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

interface SessionEditorProps {
  session: Session;
  onCancel: () => void;
  onSave: () => void;
}

export function SessionEditor({ session, onCancel, onSave }: SessionEditorProps) {
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
      onSave();
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `sessions/${session.id}`);
    }
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

  return (
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
          <button onClick={onCancel} className="px-4 py-2 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 font-medium">Отмена</button>
          <button onClick={handleSave} className="px-6 py-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 rounded-xl font-bold">Сохранить</button>
        </div>
      </div>
    </div>
  );
}
