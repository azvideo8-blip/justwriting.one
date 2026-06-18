import React, { useState, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../../core/utils/utils';
import { Label } from '../../../types';
import { useLanguage } from '../../../shared/i18n';
import { useCountUp } from '../../../shared/hooks/useCountUp';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useModalEscape } from '../../../shared/hooks/useModalEscape';
import { useFocusTrap } from '../../../shared/hooks/useFocusTrap';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { FinishModalStats } from './FinishModalStats';
import { FinishModalTags } from './FinishModalTags';
import { FinishModalExport } from './FinishModalExport';
import { Button } from '../../../shared/components/Button';

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
  labelId?: string | undefined;
  mood?: string | undefined;
}

interface WritingFinishModalProps {
  isOpen: boolean;
  tags: string[];
  setTags: (tags: string[]) => void;
  labelId?: string | undefined;
  setLabelId: (labelId?: string) => void;
  labels: Label[];
  onSave: (data: SaveData) => Promise<void>;
  onCancel: () => void;
  onSkipSave: () => void;
  streakDays?: number | undefined;
  sessionGroups?: { date: Date; sessions: unknown[] }[] | undefined;
  savedDocumentId?: string | null | undefined;
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
  savedDocumentId,
}: WritingFinishModalProps) {
  const { t } = useLanguage();
  const { execute, isLoading: isSaving } = useServiceAction();
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';
  const navigate = useNavigate();

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
  useFocusTrap(modalRef, isOpen);

  const tagInputRef = React.useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'form' | 'mood'>('form');
  const [saveDataState, setSaveDataState] = useState<SaveData | null>(null);

  const [statsExpanded, setStatsExpanded] = useState(true);
  const [formExpanded, setFormExpanded] = useState(true);
  const [tagsExpanded, setTagsExpanded] = useState(true);
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

  const finalTitle = titleInputValue.trim() || title || '';

  const handleSaveClick = () => {
    const pendingTag = tagInputRef.current?.value.trim();
    const finalTags = pendingTag && !tags.includes(pendingTag)
      ? [...tags, pendingTag]
      : tags;
    if (tagInputRef.current) tagInputRef.current.value = '';
    if (finalTags !== tags) setTags(finalTags);

    if (finalTitle && finalTitle !== title) {
      setTitle(finalTitle);
    }

    setSaveDataState({
      title: finalTitle,
      tags: finalTags,
      labelId,
    });
    setStep('mood');
  };

  const handleMoodSelect = (selectedMood?: string) => {
    if (!saveDataState) return;
    void execute(
      () => onSave({ ...saveDataState, mood: selectedMood }),
      {
        successMessage: t('save_success'),
        errorMessage: t('error_save_failed'),
        onSuccess: () => {
          onCancel();
        },
      }
    );
  };

  return (
    <div className={cn(
      "fixed inset-0 z-[var(--z-modal)] flex bg-surface-base text-text-main",
      isMobile ? "flex-col w-full h-full" : "items-center justify-center p-4 bg-surface-base/80 backdrop-blur-2xl"
    )}>
      <motion.div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="finish-modal-title"
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
              <div className="text-sm text-text-main/60 mt-1">{t('mood_checkin_subtitle')}</div>
            </div>
            <div className="flex justify-center gap-4">
              {([
                { emoji: '😊', key: 'mood_happy' },
                { emoji: '😢', key: 'mood_sad' },
                { emoji: '😠', key: 'mood_anger' },
                { emoji: '😨', key: 'mood_fear' },
                { emoji: '🤢', key: 'mood_disgust' },
                { emoji: '🤔', key: 'mood_interest' },
              ]).map((item, i) => (
                <motion.button
                  key={item.key}
                  aria-label={t(item.key)}
                  whileHover={reducedMotion ? {} : { scale: 1.3 }}
                  whileTap={reducedMotion ? {} : { scale: 0.85 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                  initial={reducedMotion ? {} : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: i * 0.06 } }}
                  disabled={isSaving}
                  onClick={() => handleMoodSelect(item.emoji)}
                  className={cn("text-4xl", isSaving && "opacity-50 cursor-not-allowed")}
                >
                  {item.emoji}
                </motion.button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={isSaving}
              onClick={() => handleMoodSelect(undefined)}
              className="text-xs text-text-main/60 hover:text-text-main/60 mt-4"
            >
              {isSaving ? t('finish_saving') : t('mood_checkin_skip')}
            </Button>

            {savedDocumentId && !isSaving && (
              <Button
                variant="brand"
                size="md"
                onClick={() => void navigate(`/ai?doc=${savedDocumentId}`)}
                className="mt-4 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-soft/10 border border-brand-soft/20 text-brand-soft text-sm font-medium hover:bg-brand-soft/20"
              >
                <Sparkles size={14} />
                Отправить в AI
              </Button>
            )}
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
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle shrink-0">
              <h3 id="finish-modal-title" className="text-lg font-bold text-text-main">{t('finish_congrats')}</h3>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar">
              <FinishModalStats
                animWords={animWords}
                animSeconds={animSeconds}
                animWpm={animWpm}
                sessionSeconds={sessionSeconds}
                totalPauseSeconds={totalPauseSeconds}
                avgWpm={avgWpm}
                wpmHistory={wpmHistory}
                streakDays={streakDays}
                sessionGroups={sessionGroups}
                t={t}
                isMobile={isMobile}
                statsExpanded={statsExpanded}
                setStatsExpanded={setStatsExpanded}
              />
              <FinishModalTags
                tags={tags}
                setTags={setTags}
                allSuggestions={allSuggestions}
                labelId={labelId}
                setLabelId={setLabelId}
                labels={labels}
                tagInputRef={tagInputRef}
                t={t}
                isMobile={isMobile}
                tagsExpanded={tagsExpanded}
                setTagsExpanded={setTagsExpanded}
                formExpanded={formExpanded}
                setFormExpanded={setFormExpanded}
                titleInputValue={titleInputValue}
                setEditTitle={setEditTitle}
              />
              <FinishModalExport
                title={title || 'Untitled'}
                content={content}
                t={t}
                isMobile={isMobile}
                exportExpanded={exportExpanded}
                setExportExpanded={setExportExpanded}
              />
            </div>

            <div className="px-4 pt-3 border-t border-border-subtle bg-surface-card shrink-0 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={onCancel}
                  className="flex-1 px-3 py-3.5 font-bold rounded-2xl border border-border-subtle text-text-main hover:bg-white/5 min-h-[44px] text-sm"
                >
                  {t('finish_back')}
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={onSkipSave}
                  className="flex-1 px-3 py-3.5 font-bold rounded-2xl border border-border-subtle text-text-main/60 hover:text-text-main hover:bg-white/5 min-h-[44px] text-sm"
                >
                  {t('finish_skip_save')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleSaveClick}
                  isLoading={isSaving}
                  className="flex-[2] px-3 py-3.5 font-bold rounded-2xl shadow-[0_0_20px_var(--brand-soft)]/30 min-h-[44px] text-sm"
                >
                  {isSaving ? t('finish_saving') : t('common_save')}
                </Button>
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

          <FinishModalStats
            animWords={animWords}
            animSeconds={animSeconds}
            animWpm={animWpm}
            sessionSeconds={sessionSeconds}
            totalPauseSeconds={totalPauseSeconds}
            avgWpm={avgWpm}
            wpmHistory={wpmHistory}
            streakDays={streakDays}
            sessionGroups={sessionGroups}
            t={t}
            isMobile={isMobile}
            statsExpanded={statsExpanded}
            setStatsExpanded={setStatsExpanded}
          />

          <FinishModalTags
            tags={tags}
            setTags={setTags}
            allSuggestions={allSuggestions}
            labelId={labelId}
            setLabelId={setLabelId}
            labels={labels}
            tagInputRef={tagInputRef}
            t={t}
            isMobile={isMobile}
            tagsExpanded={tagsExpanded}
            setTagsExpanded={setTagsExpanded}
            formExpanded={formExpanded}
            setFormExpanded={setFormExpanded}
            titleInputValue={titleInputValue}
            setEditTitle={setEditTitle}
          />

          <FinishModalExport
            title={title || 'Untitled'}
            content={content}
            t={t}
            isMobile={isMobile}
            exportExpanded={exportExpanded}
            setExportExpanded={setExportExpanded}
          />

          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="md"
              onClick={onCancel}
              className="flex-1 px-4 py-3.5 font-bold rounded-2xl border border-border-subtle text-text-main hover:bg-white/5 text-sm"
            >
              {t('finish_back')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={onSkipSave}
              className="flex-1 px-4 py-3.5 font-bold rounded-2xl border border-border-subtle text-text-main/60 hover:text-text-main hover:bg-white/5 text-sm"
            >
              {t('finish_skip_save')}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleSaveClick}
              isLoading={isSaving}
              className="flex-[2] px-4 py-3.5 font-bold rounded-2xl shadow-[0_0_20px_var(--brand-soft)]/30 text-sm"
            >
              {isSaving ? t('finish_saving') : t('common_save')}
            </Button>
          </div>
        </motion.div>
        )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
