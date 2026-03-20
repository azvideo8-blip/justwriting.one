import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, PenLine, TrendingUp } from 'lucide-react';
import { Session } from '../../types';
import { parseFirestoreDate } from '../../lib/utils';

interface ProfileFilteredSessionsProps {
  selectedWord: string;
  sessions: Session[];
  onBack: () => void;
}

export function ProfileFilteredSessions({ selectedWord, sessions, onBack }: ProfileFilteredSessionsProps) {
  const filteredSessions = sessions.filter(s => 
    s.content.toLowerCase().includes(selectedWord.toLowerCase())
  );

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-8 pb-20"
    >
      <button 
        onClick={onBack}
        className="flex items-center gap-2 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition-colors font-bold"
      >
        <ArrowLeft size={20} />
        Назад к профилю
      </button>

      <div className="space-y-4">
        <h2 className="text-3xl font-bold dark:text-stone-100">
          Заметки со словом <span className="text-stone-400 italic">"{selectedWord}"</span>
        </h2>
        <p className="text-stone-500">Найдено {filteredSessions.length} сессий</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredSessions.map(session => (
          <div 
            key={session.id}
            className="bg-white dark:bg-stone-900 p-6 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm hover:shadow-md transition-all group"
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-xl font-bold dark:text-stone-100 group-hover:text-stone-600 dark:group-hover:text-stone-400 transition-colors">
                {session.title || 'Без названия'}
              </h3>
              <span className="text-xs font-mono text-stone-400">
                {parseFirestoreDate(session.createdAt).toLocaleDateString()}
              </span>
            </div>
            <p className="text-stone-600 dark:text-stone-400 line-clamp-3 mb-6 leading-relaxed">
              {session.content}
            </p>
            <div className="flex items-center justify-between pt-4 border-t border-stone-100 dark:border-stone-800">
              <div className="flex items-center gap-4 text-xs text-stone-400">
                <span className="flex items-center gap-1"><PenLine size={12} /> {session.wordCount} слов</span>
                <span className="flex items-center gap-1"><TrendingUp size={12} /> {session.wpm} WPM</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
