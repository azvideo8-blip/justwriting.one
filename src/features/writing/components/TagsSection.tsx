import React, { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { auth } from '../../../core/firebase/auth';
import { Session } from '../../../types';
import { useLanguage } from '../../../core/i18n';
import { useSessionTags } from '../hooks/useSessionTags';

interface TagsSectionProps {
  session: Session;
  isEditing: boolean;
}

export function TagsSection({ session, isEditing: _isEditing }: TagsSectionProps) {
  const { t } = useLanguage();
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const { tags, addTag, removeTag } = useSessionTags(session.id, session.tags || []);

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const tag = newTag.trim().toLowerCase();
    if (tag) {
      addTag(tag);
      setNewTag('');
      setIsAddingTag(false);
    }
  };

  return (
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
                onClick={() => removeTag(tag)}
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
  );
}
