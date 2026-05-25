import React, { useState, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Download, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { ExportService } from '../../export/ExportService';
const WpmChart = React.lazy(() => import('./WpmChart').then(m => ({ default: m.WpmChart })));
import { Label } from '../../../types';
import { useLanguage } from '../../../core/i18n';
import { formatTime } from '../../../core/utils/formatTime';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';

import { useCountUp } from '../../../shared/hooks/useCountUp';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useModalEscape } from '../../../shared/hooks/useModalEscape';
import { useFocusTrap } from '../../../shared/hooks/useFocusTrap';
import { StreakDots } from '../../../shared/components/StreakDots';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';

const STOP_WORDS = new Set([
  'это','что','как','так','все','они','она','он','мы','вы','я','его','её','их',
  'был','была','были','есть','нет','уже','еще','ещё','тоже','вот','но','и','а',
  'в','на','по','за','из','от','до','при','для','или','если','когда','то','же',
  'бы','не','ни','даже','очень','себя','тебя','меня','него','неё','нему','нём',
  'тот','эти','этот','эта','свою','свой','свои','своё','мне','тебе','ему','ей',
  'потом','после','потому','этом','этого','этой','таких','таком','такой',
  'this','that','with','have','will','from','they','what','been','were','then',
  'than','which','their','there','when','also','into','some','more','about',
  'would','could','should','these','those','other','after','before',
]);

export interface SaveData {
  title: string;
  tags: string[];
  labelId?: string;
  mood?: string;
}

interface WritingFinishModalProps {
  isOpen: boolean;
  tags: string[];
  setTags: (tags: string[]) => void;
  labelId?: string;
  setLabelId: (labelId?: string) => void;
  labels: Label[];
  onSave: (data: SaveData) => Promise<void>;
  onCancel: () => void;
  onSkipSave: () => void;
  streakDays?: number;
  sessionGroups?: { date: Date; sessions: unknown[] }[];
}

export function WritingFinishModal({
  isOpen,
  tags,
  setTags,
  labelId,
  setLabelId,
  labels,
  onSave,
  onCancel,
  onSkipSave,
  streakDays = 0,
  sessionGroups = [],
}: WritingFinishModalProps) {
  const { t } = useLanguage();
  const { execute, isLoading: isSaving } = useServiceAction();
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';

  const wordCount = useContentStore(s => s.wordCount);
  const initialWordCount = useContentStore(s => s.initialWordCount);
  const seconds = useTimerStore(s => s.seconds);
  const sessionStartSeconds = useTimerStore(s => s.sessionStartSeconds);
  const accumulatedDuration = useTimerStore(s => s.accumulatedDuration);
  const sessionSeconds = accumulatedDuration + Math.max(0, seconds - sessionStartSeconds);
  const totalPauseSeconds = useTimerStore(s => s.totalPauseSeconds);
  const totalElapsedSeconds = sessionSeconds + totalPauseSeconds;
  const content = useContentStore(s => s.content);
  const title = useContentStore(s => s.title);
  const setTitle = useContentStore(s => s.setTitle);
  const wpmHistory = useContentStore(s => s.wpmHistory);

  const sessionWords = Math.max(0, wordCount - initialWordCount);
  const avgWpm = sessionSeconds > 0
    ? Math.round((sessionWords / sessionSeconds) * 60)
    : 0;

  const animWords = useCountUp(wordCount);
  const animSeconds = useCountUp(totalPauseSeconds > 0 ? totalElapsedSeconds : sessionSeconds);
  const animWpm = useCountUp(avgWpm);

  useModalEscape(isOpen, onCancel);
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, isOpen); // [U-06] focus trap — удерживаем фокус внутри модала

  const tagInputRef = React.useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'form' | 'mood'>('form');
  const [saveDataState, setSaveDataState] = useState<SaveData | null>(null);

  // Стейты аккордеона для мобильного
  const [statsExpanded, setStatsExpanded] = useState(true);
  const [formExpanded, setFormExpanded] = useState(true);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [exportExpanded, setExportExpanded] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setStep('form');
      setSaveDataState(null);
    }
  }, [isOpen]);

  const [editTitle, setEditTitle] = useState('');
  const titleInputValue = editTitle || title || '';

  const popularWords = React.useMemo(() => {
    if (!isOpen) return [];
    const words = content.toLowerCase().match(/(?<![а-яёa-z])[а-яёa-z]{4,}(?![а-яёa-z])/g) || [];
    const freq: Record<string, number> = {};
    words.forEach(w => {
      if (!STOP_WORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
    });
    return Object.entries(freq)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }, [content, isOpen]);

  const allSuggestions = React.useMemo(() => {
    const suggestions = new Set([(title || '').trim(), ...popularWords].filter(Boolean));
    return Array.from(suggestions);
  }, [title, popularWords]);

  const reducedMotion = useReducedMotion();
  const slideTransition = { duration: 0.22, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] };

  if (!isOpen) return null;

  const toggleTag = (tag: string) => {
    if (!tags) return;
    if (tags.includes(tag)) {
      setTags(tags.filter(t => t !== tag));
    } else {
      setTags([...tags, tag]);
    }
  };

  const exportPDF = () => ExportService.toPDF(title || 'Untitled', content);
  const exportMarkdown = () => ExportService.toMarkdown(title || 'Untitled', content);
  const exportDocx = () => {
    execute(() => ExportService.toDocx(title || 'Untitled', content), { errorMessage: t('error_export_failed') });
  };

  const finalTitle = titleInputValue.trim() || title || '';

  const handleSaveClick = () => {
    const pendingTag = tagInputRef.current?.value.trim();
    const finalTags = pendingTag && tags && !tags.includes(pendingTag)
      ? [...tags, pendingTag]
      : tags;
    if (tagInputRef.current) tagInputRef.current.value = '';
    if (finalTags !== tags) setTags(finalTags);

    if (finalTitle && finalTitle !== title) {
      setTitle(finalTitle);
    }

    setSaveDataState({
      title: finalTitle,
      tags: finalTags || [],
      labelId,
    });
    setStep('mood');
  };

  const handleMoodSelect = (selectedMood?: string) => {
    if (!saveDataState) return;
    execute(
      () => onSave({ ...saveDataState, mood: selectedMood }),
      {
        successMessage: t('save_success'),
        errorMessage: t('error_save_failed'),
        onSuccess: () => {
          onCancel(); // Закрываем модал
        },
      }
    );
  };

  return (
    <div className={cn(
      "fixed inset-0 z-[110] flex bg-surface-base text-text-main",
      isMobile ? "flex-col w-full h-full" : "items-center justify-center p-4 bg-surface-base/80 backdrop-blur-2xl"
    )}>
      <motion.div
        ref={modalRef}
        initial={isMobile ? { y: '100%' } : { scale: 0.9, opacity: 0 }}
        animate={isMobile ? { y: 0 } : { scale: 1, opacity: 1 }}
        exit={isMobile ? { y: '100%' } : { scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className={cn(
          "bg-surface-card text-text-main shadow-[0_0_60px_rgba(0,0,0,0.8)]",
          isMobile
            ? "w-full h-full flex flex-col overflow-hidden"
            : "w-full max-w-lg rounded-3xl p-8 max-h-[90vh] overflow-y-auto no-scrollbar border border-border-subtle"
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
        {step === 'mood' ? (
          <motion.div
            key="mood"
            initial={reducedMotion ? {} : { opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reducedMotion ? {} : { opacity: 0, x: -40 }}
            transition={slideTransition}
            className="text-center space-y-6 py-6 flex-1 flex flex-col justify-center p-6"
          >
            <div>
              <div className="text-xl font-bold text-text-main">{t('mood_checkin_title')}</div>
              <div className="text-sm text-text-main/40 mt-1">{t('mood_checkin_subtitle')}</div>
            </div>
            <div className="flex justify-center gap-4">
              {(['😊', '🙂', '😐', '😔', '😤'] as const).map((emoji, i) => (
                <motion.button
                  key={i}
                  whileHover={reducedMotion ? {} : { scale: 1.3 }}
                  whileTap={reducedMotion ? {} : { scale: 0.85 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                  initial={reducedMotion ? {} : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: i * 0.06 } }}
                  disabled={isSaving}
                  onClick={() => handleMoodSelect(emoji)}
                  className={cn("text-4xl", isSaving && "opacity-50 cursor-not-allowed")}
                >
                  {emoji}
                </motion.button>
              ))}
            </div>
            <button
              disabled={isSaving}
              onClick={() => handleMoodSelect(undefined)}
              className="text-xs text-text-main/30 hover:text-text-main/50 transition-colors disabled:opacity-50 mt-4"
            >
              {isSaving ? t('finish_saving') : t('mood_checkin_skip')}
            </button>
          </motion.div>
        ) : isMobile ? (
          <motion.div
            key="form"
            initial={reducedMotion ? {} : { opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? {} : { opacity: 0, y: 40 }}
            transition={slideTransition}
            className="flex-1 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle shrink-0">
              <h3 className="text-lg font-bold text-text-main">{t('finish_congrats')}</h3>
              <button
                onClick={onSkipSave}
                className="text-sm text-text-main/40 hover:text-text-main/70 transition-colors py-2"
              >
                {t('finish_skip_save')}
              </button>
            </div>

            {/* Scrollable Accordion Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar">
              {/* Accordion 1: Stats */}
              <div className="border border-border-subtle rounded-2xl overflow-hidden bg-surface-base/10">
                <button
                  type="button"
                  onClick={() => setStatsExpanded(!statsExpanded)}
                  className="w-full px-4 py-3 flex items-center justify-between bg-surface-base/20 hover:bg-surface-base/30 transition-colors font-semibold text-sm"
                >
                  <span>{t('finish_wpm_chart') || 'Session Stats'}</span>
                  {statsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                
                {statsExpanded && (
                  <div className="p-4 space-y-4">
                    {streakDays > 0 ? (
                      <div className="text-center">
                        <div className="text-3xl font-mono font-bold text-brand-primary tabular-nums">{streakDays}</div>
                        <div className="text-label font-bold uppercase tracking-widest text-text-main/40 mt-0.5">{t('finish_streak_days')}</div>
                        <StreakDots sessionGroups={sessionGroups} variant="modal" />
                      </div>
                    ) : (
                      <div className="text-center text-xs text-text-main/40">{t('finish_streak_zero')}</div>
                    )}

                    <div className="grid grid-cols-3 text-center">
                      <div className="p-1">
                        <div className="text-label font-bold uppercase tracking-widest mb-0.5 text-text-main/50">{t('writing_words')}</div>
                        <div className="text-lg font-mono font-bold text-text-main tabular-nums">{animWords}</div>
                      </div>
                      <div className="p-1 border-l border-r border-border-subtle">
                        <div className="text-label font-bold uppercase tracking-widest mb-0.5 text-text-main/50">{t('writing_time')}</div>
                        <div className="text-lg font-mono font-bold text-text-main tabular-nums">{formatTime(animSeconds)}</div>
                      </div>
                      <div className="p-1">
                        <div className="text-label font-bold uppercase tracking-widest mb-0.5 text-text-main/50">{t('writing_wpm')}</div>
                        <div className="text-lg font-mono font-bold text-text-main tabular-nums">{animWpm}</div>
                      </div>
                    </div>

                    {totalPauseSeconds > 0 && (
                      <div className="space-y-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-text-main/40">{t('finish_flow_time')}</span>
                          <span className="font-mono text-text-main tabular-nums">{formatTime(sessionSeconds)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-text-main/40">{t('finish_distraction_time')}</span>
                          <span className="font-mono text-accent-warning tabular-nums">{formatTime(totalPauseSeconds)}</span>
                        </div>
                      </div>
                    )}

                    {wpmHistory.length >= 2 && (
                      <div className="rounded-xl bg-surface-base border border-border-subtle px-3 py-2">
                        <React.Suspense fallback={null}>
                          <WpmChart data={wpmHistory} avgWpm={avgWpm} height={60} />
                        </React.Suspense>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Accordion 2: Form */}
              <div className="border border-border-subtle rounded-2xl overflow-hidden bg-surface-base/10">
                <button
                  type="button"
                  onClick={() => setFormExpanded(!formExpanded)}
                  className="w-full px-4 py-3 flex items-center justify-between bg-surface-base/20 hover:bg-surface-base/30 transition-colors font-semibold text-sm"
                >
                  <span>{t('finish_title_label') || 'Title & Label'}</span>
                  {formExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {formExpanded && (
                  <div className="p-4 space-y-4">
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        value={titleInputValue}
                        onChange={e => setEditTitle(e.target.value)}
                        placeholder={t('editor_title_placeholder')}
                        maxLength={200}
                        className="w-full px-4 py-3 rounded-xl border outline-none transition-colors bg-surface-base border-border-subtle text-text-main text-base font-medium placeholder:text-text-main/30 focus:border-text-main/40 min-h-[44px]"
                      />
                    </div>

                    {labels.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-bold uppercase tracking-wider text-text-main/50">{t('finish_labels')}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {labels.map(label => (
                            <button
                              key={label.id}
                              onClick={() => setLabelId(labelId === label.id ? undefined : label.id)}
                              className={cn(
                                "px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 min-h-[40px]",
                                labelId === label.id
                                  ? "border-2 border-white scale-105 opacity-100 shadow-lg"
                                  : labelId !== undefined
                                    ? "opacity-55 hover:opacity-85 border border-transparent"
                                    : "hover:opacity-100 border border-transparent"
                              )}
                              style={{ backgroundColor: label.color }}
                            >
                              {label.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Accordion 3: Tags */}
              <div className="border border-border-subtle rounded-2xl overflow-hidden bg-surface-base/10">
                <button
                  type="button"
                  onClick={() => setTagsExpanded(!tagsExpanded)}
                  className="w-full px-4 py-3 flex items-center justify-between bg-surface-base/20 hover:bg-surface-base/30 transition-colors font-semibold text-sm"
                >
                  <span>{t('finish_tags') || 'Tags'}</span>
                  {tagsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {tagsExpanded && (
                  <div className="p-4 space-y-4">
                    {allSuggestions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {allSuggestions.map(tag => (
                          <button
                            key={tag}
                            onClick={() => toggleTag(tag)}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors min-h-[36px]",
                              tags && tags.includes(tag)
                                ? "bg-text-main text-surface-base"
                                : "bg-surface-base text-text-main/70 hover:bg-text-main/10"
                            )}
                          >
                            #{tag}
                          </button>
                        ))}
                      </div>
                    )}
                    <input
                      ref={tagInputRef}
                      type="text"
                      placeholder={t('finish_add_tag')}
                      className="w-full px-4 py-2 rounded-xl border outline-none transition-colors bg-surface-base border-border-subtle text-text-main text-sm placeholder:text-text-main/60 focus:border-text-main/40 min-h-[44px]"
                      onBlur={(e) => {
                        const val = e.currentTarget.value.trim();
                        if (val && tags && !tags.includes(val)) {
                          setTags([...tags, val]);
                          e.currentTarget.value = '';
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = e.currentTarget.value.trim();
                          if (val && tags && !tags.includes(val)) {
                            setTags([...tags, val]);
                            e.currentTarget.value = '';
                          }
                          e.preventDefault();
                        }
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Accordion 4: Export */}
              <div className="border border-border-subtle rounded-2xl overflow-hidden bg-surface-base/10">
                <button
                  type="button"
                  onClick={() => setExportExpanded(!exportExpanded)}
                  className="w-full px-4 py-3 flex items-center justify-between bg-surface-base/20 hover:bg-surface-base/30 transition-colors font-semibold text-sm"
                >
                  <span>{t('session_export') || 'Export'}</span>
                  {exportExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {exportExpanded && (
                  <div className="p-4">
                    <div className="grid grid-cols-3 gap-3">
                      <button onClick={exportPDF} className="flex flex-col items-center justify-center gap-2 p-3 transition-colors rounded-xl bg-surface-base hover:bg-text-main/10 border border-border-subtle min-h-[56px]">
                        <FileText size={18} className="text-text-main/70" />
                        <span className="text-label font-bold text-text-main/70">PDF</span>
                      </button>
                      <button onClick={exportMarkdown} className="flex flex-col items-center justify-center gap-2 p-3 transition-colors rounded-xl bg-surface-base hover:bg-text-main/10 border border-border-subtle min-h-[56px]">
                        <FileText size={18} className="text-text-main/70" />
                        <span className="text-label font-bold text-text-main/70">MD</span>
                      </button>
                      <button onClick={exportDocx} className="flex flex-col items-center justify-center gap-2 p-3 transition-colors rounded-xl bg-surface-base hover:bg-text-main/10 border border-border-subtle min-h-[56px]">
                        <Download size={18} className="text-text-main/70" />
                        <span className="text-label font-bold text-text-main/70">DOCX</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Sticky Save Footer */}
            <div className="p-6 border-t border-border-subtle bg-surface-card shrink-0 flex flex-col gap-3"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--bottom-nav-height, 72px) + 8px)' }}>
              <div className="flex gap-3">
                <button
                  onClick={onCancel}
                  className="flex-1 px-6 py-3.5 font-bold transition-colors rounded-2xl border border-border-subtle text-text-main hover:bg-white/5 min-h-[44px]"
                >
                  {t('finish_back')}
                </button>
                <button
                  onClick={handleSaveClick}
                  disabled={isSaving}
                  className={cn(
                    "flex-1 px-6 py-3.5 font-bold transition-colors bg-text-main text-surface-base rounded-2xl shadow-[0_0_20px_var(--brand-soft)]/30 min-h-[44px]",
                    isSaving ? "opacity-60 cursor-not-allowed" : "hover:brightness-110 will-change-transform"
                  )}
                >
                  {isSaving ? t('finish_saving') : t('common_save')}
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={reducedMotion ? {} : { opacity: 0, x: -40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reducedMotion ? {} : { opacity: 0, x: 40 }}
            transition={slideTransition}
            className="space-y-5"
          >
          <div className="text-center">
            <h3 className="text-2xl font-bold text-text-main">{t('finish_congrats')}</h3>
          </div>

          {streakDays > 0 ? (
            <div className="text-center">
              <div className="text-4xl font-mono font-bold text-brand-primary tabular-nums">{streakDays}</div>
              <div className="text-label-sm font-bold uppercase tracking-widest text-text-main/40 mt-1">{t('finish_streak_days')}</div>
              <StreakDots sessionGroups={sessionGroups} variant="modal" />
            </div>
          ) : (
            <div className="text-center text-sm text-text-main/40">{t('finish_streak_zero')}</div>
          )}

          <div className="grid grid-cols-3 text-center">
            <div className="p-2">
              <div className="text-label-sm font-bold uppercase tracking-widest mb-1 text-text-main/50">{t('writing_words')}</div>
              <div className="text-xl font-mono font-bold text-text-main tabular-nums">{animWords}</div>
            </div>
            <div className="p-2" style={{ borderImage: 'linear-gradient(to bottom, transparent, var(--color-border-subtle), transparent) 1', borderLeft: '1px solid', borderRight: '1px solid' }}>
              <div className="text-label-sm font-bold uppercase tracking-widest mb-1 text-text-main/50">{t('writing_time')}</div>
              <div className="text-xl font-mono font-bold text-text-main tabular-nums">{formatTime(animSeconds)}</div>
            </div>
            <div className="p-2">
              <div className="text-label-sm font-bold uppercase tracking-widest mb-1 text-text-main/50">{t('writing_wpm')}</div>
              <div className="text-xl font-mono font-bold text-text-main tabular-nums">{animWpm}</div>
            </div>
          </div>

          {totalPauseSeconds > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-main/40">{t('finish_flow_time')}</span>
                <span className="font-mono text-text-main tabular-nums">{formatTime(sessionSeconds)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-main/40">{t('finish_distraction_time')}</span>
                <span className="font-mono text-accent-warning tabular-nums">{formatTime(totalPauseSeconds)}</span>
              </div>
            </div>
          )}

          {wpmHistory.length >= 2 && (
            <div className="rounded-2xl bg-surface-base border border-border-subtle px-4 py-3">
              <div className="text-label font-bold uppercase tracking-widest text-text-main/40 mb-3">
                {t('finish_wpm_chart')}
              </div>
              <React.Suspense fallback={null}>
                <WpmChart data={wpmHistory} avgWpm={avgWpm} height={72} />
              </React.Suspense>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-text-main/50">
              {t('finish_title_label')}
            </div>
            <input
              type="text"
              value={titleInputValue}
              onChange={e => setEditTitle(e.target.value)}
              placeholder={t('editor_title_placeholder')}
              maxLength={200} // [U-04] ограничение в соответствии с Firestore правилами
              className="w-full px-4 py-3 rounded-2xl border outline-none transition-colors bg-surface-base border-border-subtle text-text-main text-lg font-medium placeholder:text-text-main/30 focus:border-text-main/40"
              autoFocus
            />
          </div>

          {labels.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-text-main/50">{t('finish_labels')}</div>
              <div className="flex flex-wrap gap-2">
                {labels.map(label => (
                  <button
                    key={label.id}
                    onClick={() => setLabelId(labelId === label.id ? undefined : label.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2",
                      labelId === label.id
                        ? "border-2 border-white scale-105 opacity-100 shadow-lg"
                        : labelId !== undefined
                          ? "opacity-55 hover:opacity-85 border border-transparent"
                          : "hover:opacity-100 border border-transparent"
                    )}
                    style={{ backgroundColor: label.color }}
                  >
                    {label.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-text-main/50">{t('finish_tags')}</div>
            <div className="flex flex-wrap gap-2">
              {allSuggestions.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    tags && tags.includes(tag)
                      ? "bg-text-main text-surface-base"
                      : "bg-surface-base text-text-main/70 hover:bg-text-main/10"
                  )}
                >
                  #{tag}
                </button>
              ))}
            </div>
            <input
              ref={tagInputRef}
              type="text"
              placeholder={t('finish_add_tag')}
              className="w-full px-4 py-2 rounded-2xl border outline-none transition-colors bg-surface-base border-border-subtle text-text-main placeholder:text-text-main/60 focus:border-text-main/40"
              onBlur={(e) => {
                const val = e.currentTarget.value.trim();
                if (val && tags && !tags.includes(val)) {
                  setTags([...tags, val]);
                  e.currentTarget.value = '';
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = e.currentTarget.value.trim();
                  if (val && tags && !tags.includes(val)) {
                    setTags([...tags, val]);
                    e.currentTarget.value = '';
                  }
                  e.preventDefault();
                }
              }}
            />
          </div>

          <div className="space-y-3">
            <div className="text-label-sm font-bold uppercase tracking-widest text-text-main/50">{t('session_export')}</div>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={exportPDF} className="flex flex-col items-center gap-2 p-3 transition-colors rounded-2xl bg-surface-base hover:bg-text-main/10 border border-border-subtle">
                <FileText size={18} className="text-text-main/70" />
                <span className="text-label font-bold text-text-main/70">PDF</span>
              </button>
              <button onClick={exportMarkdown} className="flex flex-col items-center gap-2 p-3 transition-colors rounded-2xl bg-surface-base hover:bg-text-main/10 border border-border-subtle">
                <FileText size={18} className="text-text-main/70" />
                <span className="text-label font-bold text-text-main/70">MD</span>
              </button>
              <button onClick={exportDocx} className="flex flex-col items-center gap-2 p-3 transition-colors rounded-2xl bg-surface-base hover:bg-text-main/10 border border-border-subtle">
                <Download size={18} className="text-text-main/70" />
                <span className="text-label font-bold text-text-main/70">DOCX</span>
              </button>
            </div>
          </div>

          <div className="flex gap-3"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--bottom-nav-height, 72px) + 8px)' }}>
            <button
              onClick={onCancel}
              className="flex-1 px-6 py-4 font-bold transition-colors rounded-2xl border border-border-subtle text-text-main hover:bg-white/5"
            >
              {t('finish_back')}
            </button>
            <button
              onClick={handleSaveClick}
              disabled={isSaving}
              className={cn(
                "flex-1 px-6 py-4 font-bold transition-colors bg-text-main text-surface-base rounded-2xl shadow-[0_0_20px_var(--brand-soft)]/30",
                isSaving ? "opacity-60 cursor-not-allowed" : "hover:brightness-110 will-change-transform"
              )}
            >
              {isSaving ? t('finish_saving') : t('common_save')}
            </button>
          </div>
          <button
            onClick={onSkipSave}
            className="w-full text-sm text-text-main/40 hover:text-text-main/70 transition-colors py-2"
          >
            {t('finish_skip_save')}
          </button>
        </motion.div>
        )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
