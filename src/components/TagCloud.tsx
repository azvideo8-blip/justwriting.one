import React from 'react';
import { cn } from '../lib/utils';

interface TagCloudProps {
  tags: string[];
  title?: string;
  selectedTags?: string[];
  onToggleTag?: (tag: string) => void;
}

export function TagCloud({ tags, title = 'Облако тегов', selectedTags = [], onToggleTag }: TagCloudProps) {
  return (
    <div className="bg-white dark:bg-stone-900 p-6 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm space-y-4">
      <h3 className="font-bold dark:text-stone-100">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 ? (
          <span className="text-stone-400 text-sm italic">Тегов пока нет</span>
        ) : (
          tags.map(tag => (
            <button 
              key={tag} 
              onClick={() => onToggleTag?.(tag)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                selectedTags.includes(tag)
                  ? "bg-stone-900 text-white border-stone-900"
                  : "bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-400 border-stone-100 dark:border-stone-700 hover:border-stone-300"
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
