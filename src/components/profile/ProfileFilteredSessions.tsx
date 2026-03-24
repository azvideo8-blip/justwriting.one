import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { Session, Label } from '../../types';
import { SessionCard } from '../SessionCard';

interface ProfileFilteredSessionsProps {
  selectedWord: string;
  sessions: Session[];
  labels: Label[];
  onBack: () => void;
}

export function ProfileFilteredSessions({ selectedWord, sessions, labels, onBack }: ProfileFilteredSessionsProps) {
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
          <SessionCard key={session.id} session={session} labels={labels} />
        ))}
      </div>
    </motion.div>
  );
}
