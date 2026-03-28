import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { Session, Label } from '../../types';
import { SessionCard } from '../SessionCard';
import { useUI } from '../../contexts/UIContext';
import { cn } from '../../core/utils/utils';

interface ProfileFilteredSessionsProps {
  selectedWord: string;
  sessions: Session[];
  labels: Label[];
  onBack: () => void;
}

export function ProfileFilteredSessions({ selectedWord, sessions, labels, onBack }: ProfileFilteredSessionsProps) {
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

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
        className={cn("flex items-center gap-2 transition-colors font-bold", isV2 ? "text-white/50 hover:text-white" : "text-stone-500 hover:text-stone-900 dark:hover:text-stone-100")}
      >
        <ArrowLeft size={20} />
        Назад к профилю
      </button>

      <div className="space-y-4">
        <h2 className={cn("text-3xl font-bold", isV2 ? "text-white" : "dark:text-stone-100")}>
          Заметки со словом <span className={cn("italic", isV2 ? "text-white/50" : "text-stone-400")}>"{selectedWord}"</span>
        </h2>
        <p className={cn(isV2 ? "text-white/50" : "text-stone-500")}>Найдено {filteredSessions.length} сессий</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredSessions.map(session => (
          <SessionCard key={session.id} session={session} labels={labels} />
        ))}
      </div>
    </motion.div>
  );
}
