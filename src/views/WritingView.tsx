import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { 
  Pause, Play, Square, X, Zap, Timer, 
  Globe, Lock, Clock, Type, PenLine, CheckCircle2, Target,
  User as UserIcon, ChevronDown, Monitor, Layout, Settings
} from 'lucide-react';
import { User } from 'firebase/auth';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

import confetti from 'canvas-confetti';

interface WritingViewProps {
  user: User;
  profile: any;
}

export function WritingView({ user, profile }: WritingViewProps) {
  const [status, setStatus] = useState<'idle' | 'writing' | 'paused' | 'finished'>('idle');
  const [setupMode, setSetupMode] = useState<'selection' | 'timer-config' | 'words-config' | 'countdown' | null>(null);
  const [sessionType, setSessionType] = useState<'stopwatch' | 'timer' | 'words'>('stopwatch');
  const [timerDuration, setTimerDuration] = useState(15 * 60); // Default 15 mins
  const [wordGoal, setWordGoal] = useState(500); // Default 500 words
  const [countdown, setCountdown] = useState<number | null>(null);
  
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [wpm, setWpm] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [isPublic, setIsPublic] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [fontSize, setFontSize] = useState(20);
  const [fontFamily, setFontFamily] = useState('Inter');
  const [textWidth, setTextWidth] = useState<'centered' | 'full'>('centered');
  
  const [timeGoalReached, setTimeGoalReached] = useState(false);
  const [wordGoalReached, setWordGoalReached] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  const timerRef = useRef<any>(null);
  const countdownRef = useRef<any>(null);

  // Load draft on mount
  useEffect(() => {
    const draft = localStorage.getItem(`draft_${user.uid}`);
    if (draft) {
      setHasDraft(true);
      const { 
        content: savedContent, 
        title: savedTitle, 
        seconds: savedSeconds, 
        sessionType: savedType, 
        timerDuration: savedDuration,
        wordGoal: savedWordGoal,
        fontSize: savedFontSize,
        fontFamily: savedFontFamily,
        textWidth: savedTextWidth
      } = JSON.parse(draft);
      setContent(savedContent);
      setTitle(savedTitle || '');
      setSeconds(savedSeconds);
      setSessionType(savedType || 'stopwatch');
      setTimerDuration(savedDuration || 15 * 60);
      setWordGoal(savedWordGoal || 500);
      if (savedFontSize) setFontSize(savedFontSize);
      if (savedFontFamily) setFontFamily(savedFontFamily);
      if (savedTextWidth) setTextWidth(savedTextWidth);
    }
  }, [user.uid]);

  // Autosave to localStorage
  useEffect(() => {
    if (status === 'writing' || status === 'paused') {
      localStorage.setItem(`draft_${user.uid}`, JSON.stringify({
        content,
        title,
        seconds,
        sessionType,
        timerDuration,
        wordGoal,
        fontSize,
        fontFamily,
        textWidth,
        updatedAt: new Date().toISOString()
      }));
    }
  }, [content, title, seconds, status, user.uid, sessionType, timerDuration, wordGoal, fontSize, fontFamily, textWidth]);

  useEffect(() => {
    if (status === 'writing') {
      timerRef.current = setInterval(() => {
        setSeconds(s => {
          const next = s + 1;
          if (sessionType === 'timer' && next >= timerDuration) {
            setTimeGoalReached(true);
          }
          return next;
        });
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [status, sessionType, timerDuration]);

  useEffect(() => {
    const words = content.trim().split(/\s+/).filter(x => x.length > 3).length;
    setWordCount(words);
    if (seconds > 0) {
      setWpm(Math.round((words / seconds) * 60));
    }
    if (sessionType === 'words' && words >= wordGoal) {
      setWordGoalReached(true);
    }
  }, [content, seconds, sessionType, wordGoal]);

  useEffect(() => {
    if (wordGoalReached) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#141414', '#ffffff', '#4ade80']
      });
    }
  }, [wordGoalReached]);

  const handleStart = () => {
    setStatus('writing');
    setSetupMode(null);
    setTimeGoalReached(false);
    setWordGoalReached(false);
  };

  const startCountdown = (type: 'stopwatch' | 'timer' | 'words') => {
    setSessionType(type);
    setSetupMode('countdown');
    setCountdown(3);
    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c === 1) {
          clearInterval(countdownRef.current);
          handleStart();
          return 0;
        }
        return c ? c - 1 : 0;
      });
    }, 1000);
  };

  const handlePause = () => setStatus('paused');
  const handleFinish = () => {
    setStatus('finished');
  };

  const handleSave = async () => {
    const currentWordCount = content.trim().split(/\s+/).filter(x => x.length > 3).length;
    
    try {
      await addDoc(collection(db, 'sessions'), {
        userId: user.uid,
        authorName: user.displayName || 'Anonymous',
        authorPhoto: user.photoURL || '',
        nickname: profile?.nickname || '',
        isAnonymous,
        title,
        content,
        duration: seconds,
        wordCount: currentWordCount,
        charCount: content.length,
        wpm,
        isPublic,
        tags,
        createdAt: Timestamp.now(),
        sessionType,
        goalReached: sessionType === 'timer' ? timeGoalReached : (sessionType === 'words' ? wordGoalReached : true)
      });
      
      localStorage.removeItem(`draft_${user.uid}`);
      setContent('');
      setTitle('');
      setSeconds(0);
      setTags([]);
      setIsPublic(false);
      setIsAnonymous(false);
      setHasDraft(false);
      setStatus('idle');
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'sessions');
    }
  };

  const handleCancel = () => {
    localStorage.removeItem(`draft_${user.uid}`);
    setContent('');
    setTitle('');
    setSeconds(0);
    setTags([]);
    setIsPublic(false);
    setIsAnonymous(false);
    setHasDraft(false);
    setStatus('idle');
    setShowCancelConfirm(false);
  };

  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const removeTag = (t: string) => {
    setTags(tags.filter(tag => tag !== t));
  };

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full space-y-8 pb-20"
    >
      {/* Progress Bar at the very top */}
      {status !== 'idle' && sessionType === 'words' && (
        <div className="fixed top-0 left-0 w-full h-1 z-[100] bg-stone-100 dark:bg-stone-800">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${Math.min((wordCount / wordGoal) * 100, 100)}%` }}
            className={cn(
              "h-full transition-colors duration-500",
              wordGoalReached ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-stone-900 dark:bg-stone-100"
            )}
          />
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[60] bg-stone-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-stone-900 p-8 rounded-3xl max-w-md w-full space-y-8 shadow-2xl border border-stone-200 dark:border-stone-800 max-h-[90vh] overflow-y-auto no-scrollbar"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold">Настройки</h3>
              <button 
                onClick={() => setShowSettings(false)}
                className="p-2 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6">

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">Шрифт</label>
                <select 
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  className="w-full bg-stone-50 dark:bg-stone-800 p-4 rounded-xl font-bold dark:text-stone-100 outline-none cursor-pointer"
                >
                  <option value="Inter">Inter (Sans)</option>
                  <option value="Playfair Display">Playfair (Serif)</option>
                  <option value="JetBrains Mono">JetBrains (Mono)</option>
                  <option value="Cormorant Garamond">Cormorant (Elegant)</option>
                  <option value="Space Grotesk">Space (Modern)</option>
                </select>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">Ширина текста</label>
                <div className="flex bg-stone-50 dark:bg-stone-800 p-1 rounded-xl">
                  <button 
                    onClick={() => setTextWidth('centered')}
                    className={cn(
                      "flex-1 py-3 rounded-lg font-bold text-sm transition-all",
                      textWidth === 'centered' ? "bg-white dark:bg-stone-900 shadow-sm" : "text-stone-500"
                    )}
                  >
                    По центру
                  </button>
                  <button 
                    onClick={() => setTextWidth('full')}
                    className={cn(
                      "flex-1 py-3 rounded-lg font-bold text-sm transition-all",
                      textWidth === 'full' ? "bg-white dark:bg-stone-900 shadow-sm" : "text-stone-500"
                    )}
                  >
                    На всю ширину
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">Размер шрифта: {fontSize}px</label>
                <input 
                  type="range"
                  min="14"
                  max="32"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-full h-2 bg-stone-100 dark:bg-stone-800 rounded-lg appearance-none cursor-pointer accent-stone-900 dark:accent-stone-100"
                />
              </div>
            </div>

            <button 
              onClick={() => setShowSettings(false)}
              className="w-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 py-4 rounded-xl font-bold shadow-lg"
            >
              Готово
            </button>
          </motion.div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-[60] bg-stone-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-stone-900 w-full max-w-sm rounded-3xl p-8 shadow-2xl space-y-6 text-center"
          >
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto">
              <X size={32} />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold dark:text-stone-100">Отменить сессию?</h3>
              <p className="text-stone-500 dark:text-stone-400 text-sm">Весь несохраненный прогресс будет безвозвратно удален.</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 px-4 py-3 border border-stone-200 dark:border-stone-800 rounded-xl font-bold hover:bg-stone-50 dark:hover:bg-stone-800 transition-all"
              >
                Назад
              </button>
              <button 
                onClick={handleCancel}
                className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all"
              >
                Удалить
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Review & Save Modal */}
      {status === 'finished' && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-stone-900 w-full max-w-lg rounded-3xl p-8 shadow-2xl space-y-8"
          >
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-bold dark:text-stone-100">Сессия завершена!</h3>
              <p className="text-stone-500 dark:text-stone-400">Настройте параметры публикации перед сохранением.</p>
            </div>

            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl">
                <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Слова</div>
                <div className="text-xl font-mono font-bold dark:text-stone-100">{wordCount}</div>
              </div>
              <div className="p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl">
                <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Время</div>
                <div className="text-xl font-mono font-bold dark:text-stone-100">{formatTime(seconds)}</div>
              </div>
              <div className="p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl">
                <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">WPM</div>
                <div className="text-xl font-mono font-bold dark:text-stone-100">{wpm}</div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-stone-200 dark:bg-stone-700 rounded-full flex items-center justify-center text-stone-500 dark:text-stone-400">
                    <Globe size={20} />
                  </div>
                  <div>
                    <div className="font-bold text-sm dark:text-stone-100">Публичный доступ</div>
                    <div className="text-xs text-stone-500">Ваш текст увидят другие авторы</div>
                  </div>
                </div>
                <button 
                  onClick={() => setIsPublic(!isPublic)}
                  className={cn(
                    "w-12 h-6 rounded-full p-1 transition-colors duration-300 flex items-center",
                    isPublic ? "bg-emerald-500" : "bg-stone-300 dark:bg-stone-600"
                  )}
                >
                  <motion.div 
                    animate={{ x: isPublic ? 24 : 0 }}
                    className="w-4 h-4 bg-white rounded-full shadow-sm"
                  />
                </button>
              </div>

              <div className="flex items-center justify-between p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-stone-200 dark:bg-stone-700 rounded-full flex items-center justify-center text-stone-500 dark:text-stone-400">
                    <UserIcon size={20} />
                  </div>
                  <div>
                    <div className="font-bold text-sm dark:text-stone-100">Анонимно</div>
                    <div className="text-xs text-stone-500">Скрыть ваше имя в ленте</div>
                  </div>
                </div>
                <button 
                  onClick={() => setIsAnonymous(!isAnonymous)}
                  className={cn(
                    "w-12 h-6 rounded-full p-1 transition-colors duration-300 flex items-center",
                    isAnonymous ? "bg-stone-900 dark:bg-stone-100" : "bg-stone-300 dark:bg-stone-600"
                  )}
                >
                  <motion.div 
                    animate={{ x: isAnonymous ? 24 : 0 }}
                    className="w-4 h-4 bg-white dark:bg-stone-900 rounded-full shadow-sm"
                  />
                </button>
              </div>
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setStatus('writing')}
                className="flex-1 px-6 py-4 border border-stone-200 dark:border-stone-800 rounded-2xl font-bold hover:bg-stone-50 dark:hover:bg-stone-800 transition-all"
              >
                Вернуться
              </button>
              <button 
                onClick={handleSave}
                className="flex-1 px-6 py-4 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 rounded-2xl font-bold shadow-xl hover:scale-105 transition-all"
              >
                Сохранить
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Header Controls */}
      <div className="w-full bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-6 overflow-x-auto no-scrollbar">
            <div className="flex flex-col relative shrink-0">
            <span className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest mb-1 flex items-center gap-1">
              Время {sessionType === 'timer' && timeGoalReached && <CheckCircle2 size={10} className="text-emerald-500" />}
            </span>
            <span className={cn(
              "text-2xl font-mono font-bold transition-colors",
              sessionType === 'timer' && timeGoalReached ? "text-emerald-500" : "dark:text-stone-100"
            )}>
              {formatTime(seconds)}
            </span>
          </div>
          <div className="h-10 w-px bg-stone-100 dark:bg-stone-800" />
          <div className="flex flex-col relative">
            <span className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest mb-1 flex items-center gap-1">
              Слова {sessionType === 'words' && wordGoalReached && <CheckCircle2 size={10} className="text-emerald-500" />}
            </span>
            <span className={cn(
              "text-2xl font-mono font-bold transition-colors",
              sessionType === 'words' && wordGoalReached ? "text-emerald-500" : "dark:text-stone-100"
            )}>
              {wordCount}
              {sessionType === 'words' && <span className="text-sm text-stone-400 ml-1">/ {wordGoal}</span>}
            </span>
          </div>
          <div className="h-10 w-px bg-stone-100 dark:bg-stone-800" />
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest mb-1">WPM</span>
            <span className="text-2xl font-mono font-bold dark:text-stone-100">{wpm}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {status === 'idle' && (
            <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
              <button 
                onClick={() => setSetupMode('selection')}
                className="flex items-center justify-center gap-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 px-8 py-4 rounded-2xl font-bold shadow-xl shadow-stone-200 dark:shadow-none hover:scale-105 transition-all"
              >
                <Play size={20} fill="currentColor" />
                Новая сессия
              </button>
              {hasDraft && (
                <button 
                  onClick={() => setStatus('writing')}
                  className="flex items-center justify-center gap-2 bg-white dark:bg-stone-900 border-2 border-stone-900 dark:border-stone-100 text-stone-900 dark:text-stone-100 px-8 py-4 rounded-2xl font-bold hover:bg-stone-50 dark:hover:bg-stone-800 transition-all"
                >
                  <Clock size={20} />
                  Продолжить сессию
                </button>
              )}
              <button 
                onClick={() => setShowSettings(true)}
                className="flex items-center justify-center gap-2 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 px-6 py-4 rounded-2xl font-bold hover:bg-stone-200 dark:hover:bg-stone-700 transition-all"
                title="Настройки текста"
              >
                <Settings size={20} />
                Настройки
              </button>
            </div>
          )}
          {status === 'writing' && (
            <>
              <button 
                onClick={handlePause}
                className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 px-4 md:px-6 py-3 rounded-xl font-semibold hover:bg-stone-50 dark:hover:bg-stone-800 transition-all"
              >
                <Pause size={18} fill="currentColor" />
                Пауза
              </button>
              <button 
                onClick={handleFinish}
                className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 px-4 md:px-6 py-3 rounded-xl font-semibold shadow-lg shadow-stone-200 dark:shadow-none hover:scale-105 transition-all"
              >
                <Square size={18} fill="currentColor" />
                Завершить
              </button>
            </>
          )}
          {status === 'paused' && (
            <>
              <button 
                onClick={handleStart}
                className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 px-4 md:px-6 py-3 rounded-xl font-semibold shadow-lg shadow-stone-200 dark:shadow-none hover:scale-105 transition-all"
              >
                <Play size={18} fill="currentColor" />
                Продолжить
              </button>
              <button 
                onClick={handleFinish}
                className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 px-4 md:px-6 py-3 rounded-xl font-semibold hover:bg-stone-50 dark:hover:bg-stone-800 transition-all"
              >
                <Square size={18} fill="currentColor" />
                Завершить
              </button>
            </>
          )}
          {(status === 'writing' || status === 'paused') && (
            <button 
              onClick={() => setShowCancelConfirm(true)}
              className="p-2 md:p-3 text-stone-400 hover:text-red-500 transition-colors shrink-0"
              title="Отменить сессию"
            >
              <X size={24} />
            </button>
          )}
        </div>
      </div>
      </div>

      <div className={cn(
        "mx-auto px-4 space-y-8 transition-all duration-500",
        textWidth === 'full' ? "max-w-none" : "max-w-4xl"
      )}>
        {/* Editor Area */}
        <div className="space-y-4">
        {status !== 'idle' && (
          <input 
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Заголовок (необязательно)..."
            className="w-full px-6 py-4 bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 shadow-sm focus:shadow-md outline-none text-xl font-bold dark:text-stone-100 transition-all"
          />
        )}
        <div className="relative group">
        {setupMode === 'selection' && (
          <div className="absolute inset-0 z-20 bg-white/90 dark:bg-stone-950/90 backdrop-blur-sm rounded-3xl flex items-center justify-center p-6">
            <div className="max-w-md w-full space-y-6 text-center">
              <h3 className="text-2xl font-bold">Выберите режим сессии</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <button 
                  onClick={() => startCountdown('stopwatch')}
                  className="flex flex-col items-center gap-4 p-6 bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl hover:border-stone-400 transition-all group"
                >
                  <div className="w-12 h-12 bg-stone-900 dark:bg-stone-100 rounded-full flex items-center justify-center text-white dark:text-stone-900">
                    <Zap size={24} />
                  </div>
                  <div className="text-center">
                    <span className="block font-bold">Свободный</span>
                    <span className="text-[10px] text-stone-500 uppercase tracking-wider">Без ограничений</span>
                  </div>
                </button>
                <button 
                  onClick={() => setSetupMode('timer-config')}
                  className="flex flex-col items-center gap-4 p-6 bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl hover:border-stone-400 transition-all group"
                >
                  <div className="w-12 h-12 bg-stone-900 dark:bg-stone-100 rounded-full flex items-center justify-center text-white dark:text-stone-900">
                    <Timer size={24} />
                  </div>
                  <div className="text-center">
                    <span className="block font-bold">Таймер</span>
                    <span className="text-[10px] text-stone-500 uppercase tracking-wider">Цель по времени</span>
                  </div>
                </button>
                <button 
                  onClick={() => setSetupMode('words-config')}
                  className="flex flex-col items-center gap-4 p-6 bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl hover:border-stone-400 transition-all group"
                >
                  <div className="w-12 h-12 bg-stone-900 dark:bg-stone-100 rounded-full flex items-center justify-center text-white dark:text-stone-900">
                    <Target size={24} />
                  </div>
                  <div className="text-center">
                    <span className="block font-bold">Слова</span>
                    <span className="text-[10px] text-stone-500 uppercase tracking-wider">Цель по словам</span>
                  </div>
                </button>
              </div>
              <button onClick={() => setSetupMode(null)} className="text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 text-sm font-medium">Отмена</button>
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

        {status !== 'idle' && (
          <div className="h-4" />
        )}

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={status === 'idle' || status === 'paused'}
          placeholder={status === 'idle' ? "Нажмите 'Новая сессия', чтобы приступить к письму..." : "Пишите всё, что на уме..."}
          style={{ 
            fontSize: `${fontSize}px`,
            fontFamily: fontFamily === 'Inter' ? 'Inter, sans-serif' : 
                        fontFamily === 'Playfair Display' ? '"Playfair Display", serif' :
                        fontFamily === 'JetBrains Mono' ? '"JetBrains Mono", monospace' :
                        fontFamily === 'Cormorant Garamond' ? '"Cormorant Garamond", serif' :
                        fontFamily === 'Space Grotesk' ? '"Space Grotesk", sans-serif' : 'inherit'
          }}
          className={cn(
            "w-full min-h-[400px] md:min-h-[500px] p-6 md:p-12 bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-sm focus:shadow-xl focus:border-stone-300 dark:focus:border-stone-700 transition-all outline-none leading-relaxed resize-none dark:text-stone-100",
            (status === 'idle' || status === 'paused') && "opacity-50 cursor-not-allowed"
          )}
        />
      </div>
      </div>

        {/* Tags Input */}
        {status !== 'idle' && (
          <div className="flex flex-wrap items-center gap-2 p-4 bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800">
          <div className="flex flex-wrap gap-2">
            {tags.map(tag => (
              <span key={tag} className="flex items-center gap-1 px-2 py-1 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 rounded-lg text-xs font-medium">
                #{tag}
                <button onClick={() => removeTag(tag)} className="hover:text-red-500"><X size={12} /></button>
              </span>
            ))}
          </div>
          <input 
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTag()}
            placeholder="Добавить тег..."
            className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm dark:text-stone-100"
          />
        </div>
      )}
      </div>
    </motion.div>
  );
}
