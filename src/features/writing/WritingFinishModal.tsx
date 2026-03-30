import React from 'react';
import { motion } from 'motion/react';
import { Globe, User as UserIcon, FileText, Download, FileJson } from 'lucide-react';
import { cn } from '../../core/utils/utils';
import { ExportService } from '../export/ExportService';
import { Label } from '../../types';
import { useUI } from '../../contexts/UIContext';

interface WritingFinishModalProps {
  status: 'idle' | 'writing' | 'paused' | 'finished';
  wordCount: number;
  seconds: number;
  wpm: number;
  formatTime: (s: number) => string;
  isPublic: boolean;
  setIsPublic: (val: boolean) => void;
  isAnonymous: boolean;
  setIsAnonymous: (val: boolean) => void;
  handleSave: (isLocalOnly: boolean) => void;
  setStatus: (status: 'idle' | 'writing' | 'paused' | 'finished') => void;
  content: string;
  title: string;
  tags: string[];
  setTags: (tags: string[]) => void;
  labelId?: string;
  setLabelId: (labelId?: string) => void;
  labels: Label[];
  isLocalOnly: boolean;
}

export function WritingFinishModal({
  status,
  wordCount,
  seconds,
  wpm,
  formatTime,
  isPublic,
  setIsPublic,
  isAnonymous,
  setIsAnonymous,
  handleSave,
  setStatus,
  content,
  title,
  tags,
  setTags,
  labelId,
  setLabelId,
  labels,
  isLocalOnly
}: WritingFinishModalProps) {
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  if (status !== 'finished') return null;

  const handleSaveClick = () => {
    handleSave(isLocalOnly);
  };

  const popularWords = React.useMemo(() => {
    const words = content.toLowerCase().match(/\b\w{5,}\b/g) || [];
    const freq: Record<string, number> = {};
    words.forEach(w => freq[w] = (freq[w] || 0) + 1);
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(e => e[0]);
  }, [content]);

  const allSuggestions = React.useMemo(() => {
    const suggestions = new Set([title.trim(), ...popularWords].filter(Boolean));
    return Array.from(suggestions);
  }, [title, popularWords]);

  const toggleTag = (tag: string) => {
    if (tags.includes(tag)) {
      setTags(tags.filter(t => t !== tag));
    } else {
      setTags([...tags, tag]);
    }
  };

  const exportPDF = () => {
    ExportService.toPDF(title || 'Untitled Session', content);
  };

  const exportMarkdown = () => {
    ExportService.toMarkdown(title || 'Untitled Session', content);
  };

  const exportDocx = async () => {
    await ExportService.toDocx(title || 'Untitled Session', content);
  };

  return (
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center p-4", isV2 ? "bg-[#0A0A0B]/80 backdrop-blur-2xl" : "bg-stone-900/60 backdrop-blur-md")}>
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={cn(
          "w-full max-w-lg rounded-3xl p-8 space-y-8 max-h-[90vh] overflow-y-auto no-scrollbar",
          isV2 
            ? "bg-[#0A0A0B]/80 backdrop-blur-2xl border border-white/10 text-[#E5E5E0] shadow-[0_0_60px_rgba(0,0,0,0.8)]" 
            : "bg-white dark:bg-stone-900 shadow-2xl border border-stone-200 dark:border-stone-800"
        )}
      >
        <div className="text-center space-y-2">
          <h3 className={cn("text-2xl font-bold", isV2 ? "text-white" : "dark:text-stone-100")}>Сессия завершена!</h3>
          <p className={cn(isV2 ? "text-white/50" : "text-stone-500 dark:text-stone-400")}>Выберите теги для вашей сессии.</p>
        </div>

        <div className="space-y-4">
          <div className={cn("text-sm font-bold uppercase tracking-wider", isV2 ? "text-white/50" : "text-stone-500")}>Бирка</div>
          <div className="flex flex-wrap gap-2">
            {labels.map(label => (
              <button
                key={label.id}
                onClick={() => setLabelId(labelId === label.id ? undefined : label.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                  labelId === label.id
                    ? (isV2 ? "ring-2 ring-offset-2 ring-offset-[#0A0A0B]" : "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-stone-900")
                    : "hover:opacity-80"
                )}
                style={{ backgroundColor: label.color, outlineColor: label.color }}
              >
                {label.name}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className={cn("text-sm font-bold uppercase tracking-wider", isV2 ? "text-white/50" : "text-stone-500")}>Теги</div>
          <div className="flex flex-wrap gap-2">
            {allSuggestions.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1",
                  tags.includes(tag)
                    ? (isV2 ? "bg-white text-black" : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900")
                    : (isV2 ? "bg-white/5 text-white/70 hover:bg-white/10" : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700")
                )}
              >
                #{tag}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Добавить свой тег..."
            className={cn(
              "w-full px-4 py-2 rounded-xl border outline-none transition-all",
              isV2 ? "bg-white/5 border-white/10 text-white placeholder-white/60 focus:border-white/30 focus:bg-white/10" : "border-stone-200 dark:border-stone-800 bg-transparent focus:border-stone-400 dark:focus:border-stone-600"
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const val = e.currentTarget.value.trim();
                if (val && !tags.includes(val)) {
                  setTags([...tags, val]);
                  e.currentTarget.value = '';
                }
              }
            }}
          />
        </div>

        <div className={cn(
          "grid grid-cols-3 gap-4 text-center",
          isV2 ? "divide-x divide-white/10" : ""
        )}>
          <div className={cn(isV2 ? "p-2" : "p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl")}>
            <div className={cn("text-[10px] font-bold uppercase tracking-widest mb-1", isV2 ? "text-white/50" : "text-stone-400")}>Слова</div>
            <div className={cn("text-xl font-mono font-bold", isV2 ? "text-white" : "dark:text-stone-100")}>{wordCount}</div>
          </div>
          <div className={cn(isV2 ? "p-2" : "p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl")}>
            <div className={cn("text-[10px] font-bold uppercase tracking-widest mb-1", isV2 ? "text-white/50" : "text-stone-400")}>Время</div>
            <div className={cn("text-xl font-mono font-bold", isV2 ? "text-white" : "dark:text-stone-100")}>{formatTime(seconds)}</div>
          </div>
          <div className={cn(isV2 ? "p-2" : "p-4 bg-stone-50 dark:bg-stone-800 rounded-2xl")}>
            <div className={cn("text-[10px] font-bold uppercase tracking-widest mb-1", isV2 ? "text-white/50" : "text-stone-400")}>WPM</div>
            <div className={cn("text-xl font-mono font-bold", isV2 ? "text-white" : "dark:text-stone-100")}>{wpm}</div>
          </div>
        </div>

        {!isLocalOnly ? (
          <div className="space-y-4">
            <div className={cn("flex items-center justify-between p-4 rounded-2xl", isV2 ? "bg-white/5 border border-white/5" : "bg-stone-50 dark:bg-stone-800")}>
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", isV2 ? "bg-white/10 text-white/70" : "bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400")}>
                  <Globe size={20} />
                </div>
                <div>
                  <div className={cn("font-bold text-sm", isV2 ? "text-white" : "dark:text-stone-100")}>Публичный доступ</div>
                  <div className={cn("text-xs", isV2 ? "text-white/50" : "text-stone-500")}>Ваш текст увидят другие авторы</div>
                </div>
              </div>
              <button 
                onClick={() => setIsPublic(!isPublic)}
                className={cn(
                  "w-12 h-6 rounded-full p-1 transition-colors duration-300 flex items-center",
                  isPublic 
                    ? (isV2 ? "bg-white" : "bg-emerald-500") 
                    : (isV2 ? "bg-white/20" : "bg-stone-300 dark:bg-stone-600")
                )}
              >
                <motion.div 
                  animate={{ x: isPublic ? 24 : 0 }}
                  className={cn("w-4 h-4 rounded-full shadow-sm", isV2 && isPublic ? "bg-black" : "bg-white")}
                />
              </button>
            </div>

            <div className={cn("flex items-center justify-between p-4 rounded-2xl", isV2 ? "bg-white/5 border border-white/5" : "bg-stone-50 dark:bg-stone-800")}>
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", isV2 ? "bg-white/10 text-white/70" : "bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400")}>
                  <UserIcon size={20} />
                </div>
                <div>
                  <div className={cn("font-bold text-sm", isV2 ? "text-white" : "dark:text-stone-100")}>Анонимно</div>
                  <div className={cn("text-xs", isV2 ? "text-white/50" : "text-stone-500")}>Скрыть ваше имя в ленте</div>
                </div>
              </div>
              <button 
                onClick={() => setIsAnonymous(!isAnonymous)}
                className={cn(
                  "w-12 h-6 rounded-full p-1 transition-colors duration-300 flex items-center",
                  isAnonymous 
                    ? (isV2 ? "bg-white" : "bg-stone-900 dark:bg-stone-100") 
                    : (isV2 ? "bg-white/20" : "bg-stone-300 dark:bg-stone-600")
                )}
              >
                <motion.div 
                  animate={{ x: isAnonymous ? 24 : 0 }}
                  className={cn("w-4 h-4 rounded-full shadow-sm", isV2 && isAnonymous ? "bg-black" : "bg-white dark:bg-stone-900")}
                />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className={cn("p-4 rounded-2xl space-y-3", isV2 ? "bg-white/5 border border-white/5" : "bg-stone-50 dark:bg-stone-800")}>
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", isV2 ? "bg-white/10 text-white/70" : "bg-stone-200 dark:bg-stone-700 text-stone-500 dark:text-stone-400")}>
                  <FileText size={20} />
                </div>
                <div>
                  <div className={cn("font-bold text-sm", isV2 ? "text-white" : "dark:text-stone-100")}>Локальная сессия</div>
                  <div className={cn("text-xs", isV2 ? "text-white/50" : "text-stone-500")}>Текст будет сохранен только в вашем браузере</div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <label className={cn("text-[10px] font-bold uppercase tracking-widest", isV2 ? "text-white/50" : "text-stone-400")}>Экспорт</label>
          <div className="grid grid-cols-3 gap-3">
            <button 
              onClick={exportPDF}
              className={cn(
                "flex flex-col items-center gap-2 p-4 transition-all",
                isV2 ? "rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5" : "bg-stone-50 dark:bg-stone-800 rounded-2xl hover:bg-stone-100 dark:hover:bg-stone-700"
              )}
            >
              <FileText size={20} className={isV2 ? "text-white/70" : "text-red-500"} />
              <span className={cn("text-[10px] font-bold", isV2 ? "text-white/70" : "")}>PDF</span>
            </button>
            <button 
              onClick={exportMarkdown}
              className={cn(
                "flex flex-col items-center gap-2 p-4 transition-all",
                isV2 ? "rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5" : "bg-stone-50 dark:bg-stone-800 rounded-2xl hover:bg-stone-100 dark:hover:bg-stone-700"
              )}
            >
              <FileJson size={20} className={isV2 ? "text-white/70" : "text-blue-500"} />
              <span className={cn("text-[10px] font-bold", isV2 ? "text-white/70" : "")}>MD</span>
            </button>
            <button 
              onClick={exportDocx}
              className={cn(
                "flex flex-col items-center gap-2 p-4 transition-all",
                isV2 ? "rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5" : "bg-stone-50 dark:bg-stone-800 rounded-2xl hover:bg-stone-100 dark:hover:bg-stone-700"
              )}
            >
              <Download size={20} className={isV2 ? "text-white/70" : "text-emerald-500"} />
              <span className={cn("text-[10px] font-bold", isV2 ? "text-white/70" : "")}>DOCX</span>
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <button 
            onClick={() => setStatus('writing')}
            className={cn(
              "flex-1 px-6 py-4 font-bold transition-all",
              isV2 ? "rounded-xl border border-white/10 text-white hover:bg-white/5" : "border border-stone-200 dark:border-stone-800 rounded-2xl hover:bg-stone-50 dark:hover:bg-stone-800"
            )}
          >
            Вернуться
          </button>
          <button 
            onClick={handleSaveClick}
            className={cn(
              "flex-1 px-6 py-4 font-bold transition-all",
              isV2 ? "bg-white text-black rounded-xl shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:scale-105" : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 rounded-2xl shadow-xl hover:scale-105"
            )}
          >
            Сохранить
          </button>
        </div>
      </motion.div>
    </div>
  );
}
