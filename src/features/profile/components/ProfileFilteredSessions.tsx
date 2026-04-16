import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { Session, Label } from '../../../types';
import { SessionCard } from '../../writing/components/SessionCard';

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
        className="flex items-center gap-2 transition-colors font-bold text-text-main/50 hover:text-text-main"
      >
        <ArrowLeft size={20} />
        Назад к профилю
      </button>

      <div className="space-y-4">
        <h2 className="text-3xl font-bold text-text-main">
          Заметки со словом <span className="italic text-text-main/50">&quot;{selectedWord}&quot;</span>
        </h2>
        <p className="text-text-main/50">Найдено {filteredSessions.length} сессий</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredSessions.map(session => (
          <SessionCard key={session.id} session={session} labels={labels} />
        ))}
      </div>
    </motion.div>
  );
}
