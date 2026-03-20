import React from 'react';

interface TagCloudProps {
  tags: string[];
  title?: string;
}

export function TagCloud({ tags, title = 'Облако тегов' }: TagCloudProps) {
  return (
    <div className="bg-white dark:bg-stone-900 p-6 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm space-y-4">
      <h3 className="font-bold dark:text-stone-100">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 ? (
          <span className="text-stone-400 text-sm italic">Тегов пока нет</span>
        ) : (
          tags.map(tag => (
            <span 
              key={tag} 
              className="px-3 py-1 bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-400 rounded-full text-xs font-medium border border-stone-100 dark:border-stone-700"
            >
              #{tag}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
