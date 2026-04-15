import React from 'react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';

interface TagCloudProps {
  tags: string[];
  title?: string;
  selectedTags?: string[];
  onToggleTag?: (tag: string) => void;
}

export function TagCloud({ tags, title, selectedTags = [], onToggleTag }: TagCloudProps) {
  const { t } = useLanguage();
  const displayTitle = title || t('tag_cloud_title');
  return (
    <div className="p-6 rounded-3xl space-y-4 transition-all bg-surface-card backdrop-blur-xl border border-border-subtle shadow-sm">
      <h3 className="font-bold text-text-main">{displayTitle}</h3>
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 ? (
          <span className="text-sm italic text-text-main/40">{t('tag_cloud_empty')}</span>
        ) : (
          tags.map(tag => (
            <button 
              key={tag} 
              onClick={() => onToggleTag?.(tag)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                selectedTags.includes(tag)
                  ? "bg-text-main text-surface-base border-text-main"
                  : "bg-surface-base/5 text-text-main/50 border-border-subtle hover:bg-surface-base/10 hover:text-text-main"
              )}
            >
              #{tag}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
