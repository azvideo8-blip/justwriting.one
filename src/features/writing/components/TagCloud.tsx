import React from 'react';
import { cn } from '../../../core/utils/utils';
import { useUI } from '../../../contexts/UIContext';

interface TagCloudProps {
  tags: string[];
  title?: string;
  selectedTags?: string[];
  onToggleTag?: (tag: string) => void;
}

export function TagCloud({ tags, title = 'Облако тегов', selectedTags = [], onToggleTag }: TagCloudProps) {
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  return (
    <div className={cn(
      "p-6 rounded-3xl space-y-4 transition-all",
      isV2 
        ? "bg-white/5 backdrop-blur-xl border border-white/10 text-[#E5E5E0]" 
        : "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-sm"
    )}>
      <h3 className={cn("font-bold", isV2 ? "text-white" : "dark:text-stone-100")}>{title}</h3>
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 ? (
          <span className={cn("text-sm italic", isV2 ? "text-white/30" : "text-stone-400")}>Тегов пока нет</span>
        ) : (
          tags.map(tag => (
            <button 
              key={tag} 
              onClick={() => onToggleTag?.(tag)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                selectedTags.includes(tag)
                  ? (isV2 ? "bg-white text-black border-white" : "bg-stone-900 text-white border-stone-900")
                  : (isV2 ? "bg-white/5 text-white/50 border-white/10 hover:bg-white/10 hover:text-white" : "bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-400 border-stone-100 dark:border-stone-700 hover:border-stone-300")
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
