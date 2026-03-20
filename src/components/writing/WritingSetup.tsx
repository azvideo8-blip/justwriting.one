import React from 'react';
import { motion } from 'motion/react';
import { Zap, Timer, Target, PenLine } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Session } from '../../types';

interface WritingSetupProps {
  setupMode: 'selection' | 'timer-config' | 'words-config' | 'countdown' | 'session-selection' | null;
  setSetupMode: (mode: any) => void;
  startCountdown: (type: 'stopwatch' | 'timer' | 'words') => void;
  timerDuration: number;
  setTimerDuration: (duration: number) => void;
  wordGoal: number;
  setWordGoal: (goal: number) => void;
  countdown: number | null;
  userSessions: Session[];
  continueSession: (session: Session) => void;
  formatTime: (s: number) => string;
}

export function WritingSetup({
  setupMode,
  setSetupMode,
  startCountdown,
  timerDuration,
  setTimerDuration,
  wordGoal,
  setWordGoal,
  countdown,
  userSessions,
  continueSession,
  formatTime
}: WritingSetupProps) {
  if (!setupMode) return null;

  return (
    <>
      {setupMode === 'selection' && (
        <div className="absolute inset-0 z-20 bg-white/90 dark:bg-stone-950/90 backdrop-blur-sm rounded-3xl flex items-center justify-center p-6">
          <div className="max-w-md w-full space-y-8">
            <div className="text-center space-y-2">
              <h3 className="text-3xl font-bold dark:text-stone-100">Выберите режим</h3>
              <p className="text-stone-500 dark:text-stone-400">Как вы хотите писать сегодня?</p>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <button 
                onClick={() => startCountdown('stopwatch')}
                className="group flex items-center gap-6 p-6 bg-white dark:bg-stone-900 border-2 border-stone-100 dark:border-stone-800 rounded-3xl hover:border-stone-900 dark:hover:border-stone-100 transition-all text-left"
              >
                <div className="w-14 h-14 bg-stone-100 dark:bg-stone-800 rounded-2xl flex items-center justify-center text-stone-900 dark:text-stone-100 group-hover:bg-stone-900 group-hover:text-white dark:group-hover:bg-stone-100 dark:group-hover:text-stone-900 transition-colors">
                  <Zap size={28} fill="currentColor" />
                </div>
                <div>
                  <div className="font-bold text-lg dark:text-stone-100">Свободный поток</div>
                  <div className="text-sm text-stone-500">Просто секундомер. Пишите сколько угодно.</div>
                </div>
              </button>

              <button 
                onClick={() => setSetupMode('timer-config')}
                className="group flex items-center gap-6 p-6 bg-white dark:bg-stone-900 border-2 border-stone-100 dark:border-stone-800 rounded-3xl hover:border-stone-900 dark:hover:border-stone-100 transition-all text-left"
              >
                <div className="w-14 h-14 bg-stone-100 dark:bg-stone-800 rounded-2xl flex items-center justify-center text-stone-900 dark:text-stone-100 group-hover:bg-stone-900 group-hover:text-white dark:group-hover:bg-stone-100 dark:group-hover:text-stone-900 transition-colors">
                  <Timer size={28} />
                </div>
                <div>
                  <div className="font-bold text-lg dark:text-stone-100">По таймеру</div>
                  <div className="text-sm text-stone-500">Установите время. Фокусируйтесь до звонка.</div>
                </div>
              </button>

              <button 
                onClick={() => setSetupMode('words-config')}
                className="group flex items-center gap-6 p-6 bg-white dark:bg-stone-900 border-2 border-stone-100 dark:border-stone-800 rounded-3xl hover:border-stone-900 dark:hover:border-stone-100 transition-all text-left"
              >
                <div className="w-14 h-14 bg-stone-100 dark:bg-stone-800 rounded-2xl flex items-center justify-center text-stone-900 dark:text-stone-100 group-hover:bg-stone-900 group-hover:text-white dark:group-hover:bg-stone-100 dark:group-hover:text-stone-900 transition-colors">
                  <Target size={28} />
                </div>
                <div>
                  <div className="font-bold text-lg dark:text-stone-100">Цель по словам</div>
                  <div className="text-sm text-stone-500">Пишите, пока не достигнете лимита слов.</div>
                </div>
              </button>
            </div>
            <button onClick={() => setSetupMode(null)} className="w-full text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 text-sm font-medium">Отмена</button>
          </div>
        </div>
      )}

      {setupMode === 'timer-config' && (
        <div className="absolute inset-0 z-20 bg-white/90 dark:bg-stone-950/90 backdrop-blur-sm rounded-3xl flex items-center justify-center p-6">
          <div className="max-w-sm w-full space-y-8 text-center">
            <h3 className="text-2xl font-bold">Установите таймер</h3>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col items-center gap-4">
                <input 
                  type="number" 
                  value={timerDuration / 60}
                  onChange={(e) => setTimerDuration(Number(e.target.value) * 60)}
                  className="w-32 text-center text-4xl font-bold bg-transparent border-b-2 border-stone-900 dark:border-stone-100 outline-none"
                  min="1"
                />
                <div className="text-stone-400 text-sm font-bold uppercase tracking-widest">минут</div>
              </div>
              <button 
                onClick={() => startCountdown('timer')}
                className="w-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 py-4 rounded-xl font-bold shadow-lg"
              >
                Начать
              </button>
            </div>
            <button onClick={() => setSetupMode('selection')} className="text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 text-sm font-medium">Назад</button>
          </div>
        </div>
      )}

      {setupMode === 'countdown' && (
        <div className="absolute inset-0 z-30 bg-stone-900 dark:bg-stone-100 rounded-3xl flex items-center justify-center">
          <motion.div 
            key={countdown}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-white dark:text-stone-900 text-9xl font-bold"
          >
            {countdown === 0 ? "GO!" : countdown}
          </motion.div>
        </div>
      )}

      {setupMode === 'words-config' && (
        <div className="absolute inset-0 z-20 bg-white/90 dark:bg-stone-950/90 backdrop-blur-sm rounded-3xl flex items-center justify-center p-6">
          <div className="max-w-sm w-full space-y-8 text-center">
            <h3 className="text-2xl font-bold">Цель по словам</h3>
            <div className="flex flex-col gap-6">
              <div className="flex flex-col items-center gap-4">
                <input 
                  type="number" 
                  value={wordGoal}
                  onChange={(e) => setWordGoal(Number(e.target.value))}
                  className="w-32 text-center text-4xl font-bold bg-transparent border-b-2 border-stone-900 dark:border-stone-100 outline-none"
                  min="10"
                  step="50"
                />
                <div className="text-stone-400 text-sm font-bold uppercase tracking-widest">слов</div>
              </div>
              <button 
                onClick={() => startCountdown('words')}
                className="w-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 py-4 rounded-xl font-bold shadow-lg"
              >
                Начать
              </button>
            </div>
            <button onClick={() => setSetupMode('selection')} className="text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 text-sm font-medium">Назад</button>
          </div>
        </div>
      )}

      {setupMode === 'session-selection' && (
        <div className="absolute inset-0 z-20 bg-white/90 dark:bg-stone-950/90 backdrop-blur-sm rounded-3xl flex items-center justify-center p-6">
          <div className="max-w-2xl w-full space-y-6 text-center">
            <h3 className="text-2xl font-bold">Выберите сессию для продолжения</h3>
            <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto pr-2 no-scrollbar">
              {userSessions.length === 0 ? (
                <div className="p-12 text-stone-400 italic bg-stone-50 dark:bg-stone-900 rounded-2xl">
                  У вас пока нет сохраненных сессий
                </div>
              ) : (
                userSessions.map(session => (
                  <button 
                    key={session.id}
                    onClick={() => continueSession(session)}
                    className="flex flex-col gap-3 p-5 bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl hover:border-stone-400 transition-all text-left group"
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-stone-200 dark:bg-stone-800 rounded-full flex items-center justify-center text-stone-500">
                          <PenLine size={20} />
                        </div>
                        <div>
                          <div className="font-bold dark:text-stone-100 group-hover:text-stone-900 dark:group-hover:text-white transition-colors">
                            {session.title || 'Без названия'}
                          </div>
                          <div className="text-xs text-stone-500">
                            {session.wordCount} слов · {formatTime(session.duration)}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-stone-400 font-mono">
                        {session.createdAt?.toDate ? format(session.createdAt.toDate(), 'd MMM, HH:mm', { locale: ru }) : ''}
                      </div>
                    </div>
                    
                    {session.content && (
                      <div className="text-xs text-stone-400 dark:text-stone-500 line-clamp-2 italic border-l-2 border-stone-200 dark:border-stone-800 pl-3">
                        {session.content.slice(0, 150)}
                        {session.content.length > 150 ? '...' : ''}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
            <button onClick={() => setSetupMode(null)} className="text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 text-sm font-medium">Отмена</button>
          </div>
        </div>
      )}
    </>
  );
}
