import React, { useState } from 'react';
import { X } from 'lucide-react';
import { SessionService } from '../services/SessionService';
import { Session } from '../../../types';
import { useLanguage } from '../../../core/i18n';

interface SessionEditorProps {
  session: Session;
  onCancel: () => void;
  onSave: () => void;
}

export function SessionEditor({ session, onCancel, onSave }: SessionEditorProps) {
  const { t } = useLanguage();
  const [editContent, setEditContent] = useState(session.content);
  const [editTitle, setEditTitle] = useState(session.title || '');
  const [editTags, setEditTags] = useState<string[]>(session.tags || []);
  const [editIsPublic, setEditIsPublic] = useState(session.isPublic);
  const [tagInput, setTagInput] = useState('');

  const handleSave = async () => {
    await SessionService.updateSession(session.id, {
      content: editContent,
      title: editTitle,
      tags: editTags,
      isPublic: editIsPublic,
      wordCount: editContent.trim().split(/\s+/).filter(x => x.length > 0).length,
      charCount: editContent.length
    });
    onSave();
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
        placeholder={t('editor_title_placeholder')}
        className="w-full px-4 py-2 bg-surface-base rounded-2xl border border-border-subtle outline-none focus:border-text-main/40 transition-all text-text-main font-bold"
      />
      <textarea 
        value={editContent}
        onChange={(e) => setEditContent(e.target.value)}
        className="w-full min-h-[200px] p-4 bg-surface-base rounded-2xl border border-border-subtle outline-none focus:border-text-main/40 transition-all text-text-main"
      />
      <div className="flex flex-wrap items-center gap-2 p-3 bg-surface-base rounded-2xl border border-border-subtle">
        <div className="flex flex-wrap gap-2">
          {editTags.map(tag => (
            <span key={tag} className="flex items-center gap-1 px-2 py-1 bg-surface-card text-text-main/60 rounded-lg text-xs font-medium border border-border-subtle">
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
          placeholder={t('session_tag_placeholder')}
          className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm text-text-main"
        />
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={editIsPublic} onChange={(e) => setEditIsPublic(e.target.checked)} className="rounded border-border-subtle accent-text-main" />
          <span className="text-sm text-text-main/50">{t('setup_public')}</span>
        </label>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-text-main/50 hover:text-text-main font-medium">{t('common_cancel')}</button>
          <button onClick={handleSave} className="px-6 py-2 bg-text-main text-surface-base rounded-2xl font-bold">{t('common_save')}</button>
        </div>
      </div>
    </div>
  );
}
