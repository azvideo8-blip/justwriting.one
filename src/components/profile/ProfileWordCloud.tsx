import React, { useMemo } from 'react';
import { Cloud } from 'lucide-react';
import { Session } from '../../types';
import { useLanguage } from '../../core/i18n';
import { useUI } from '../../contexts/UIContext';
import { cn } from '../../core/utils/utils';

interface ProfileWordCloudProps {
  sessions: Session[];
  onWordClick: (word: string) => void;
}

export function ProfileWordCloud({ sessions, onWordClick }: ProfileWordCloudProps) {
  const { t } = useLanguage();
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  const wordCloud = useMemo(() => {
    const stopWords = new Set(['меня', 'тебя', 'было', 'есть', 'если', 'когда', 'только', 'через', 'после', 'этого', 'потому', 'чтобы', 'будет', 'очень', 'просто', 'можно', 'нужно', 'хотя', 'перед', 'между', 'вдоль', 'кроме', 'вместо', 'ввиду', 'вслед', 'среди', 'будто', 'словно', 'точно', 'ровно', 'почти', 'разве', 'неужели', 'даже', 'лишь', 'хоть', 'пусть', 'пускай', 'давай', 'именно', 'как', 'что', 'это', 'все', 'так', 'вот', 'уже', 'был', 'была', 'были', 'для', 'его', 'ее', 'их', 'нам', 'вам', 'мне', 'тебе', 'себе', 'свои', 'свой', 'своя', 'свое', 'всех', 'всего', 'всем', 'всеми', 'эти', 'этих', 'этим', 'этими', 'этот', 'эта', 'это', 'эту', 'этой', 'этом']);
    const words: Record<string, number> = {};
    
    sessions.forEach(s => {
      const contentWords = s.content.toLowerCase()
        .replace(/[^\w\sа-яё]/gi, '')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w));
      
      contentWords.forEach(w => {
        words[w] = (words[w] || 0) + 1;
      });
    });

    return Object.entries(words)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);
  }, [sessions]);

  return (
    <div className={cn(
      "p-6 rounded-3xl transition-all space-y-4",
      isV2 
        ? "bg-white/5 backdrop-blur-xl border border-white/10 text-[#E5E5E0]" 
        : "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-sm"
    )}>
      <h3 className={cn("font-bold flex items-center gap-2", isV2 ? "text-white" : "dark:text-stone-100")}>
        <Cloud size={18} className={isV2 ? "text-white/50" : "text-stone-400"} />
        {t('profile_word_cloud')}
      </h3>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {wordCloud.length === 0 ? (
          <span className={cn("text-sm italic", isV2 ? "text-white/30" : "text-stone-400")}>{t('profile_no_words')}</span>
        ) : (
          wordCloud.map(([word, count]) => (
            <button 
              key={word} 
              onClick={() => onWordClick(word)}
              className={cn("transition-colors", isV2 ? "hover:text-white" : "hover:text-stone-900 dark:hover:text-stone-100")}
              style={{ 
                fontSize: `${Math.max(0.75, Math.min(1.5, 0.75 + count * 0.1))}rem`,
                opacity: Math.max(0.5, Math.min(1, 0.5 + count * 0.1)),
                fontWeight: count > 5 ? 'bold' : 'normal'
              }}
            >
              {word}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
