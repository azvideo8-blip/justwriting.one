import React, { useState, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Sparkles, Check } from 'lucide-react';

import { useShallow } from 'zustand/react/shallow';
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
import { useNavigate } from 'react-router-dom';
import { FinishModalStats } from './FinishModalStats';
import { FinishModalTags } from './FinishModalTags';
import { FinishModalExport } from './FinishModalExport';
import { Button } from '../../../shared/components/Button';
import { readingTimeMinutes } from '../../../shared/utils/readingTime';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { getOrCreateGuestId } from '../../../core/storage/localDb';
import { getAuth } from 'firebase/auth';

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

const TOKENIZER_RE = /(?<![а-яёa-z])[а-яёa-z]{4,}(?![а-яёa-z])/g;

interface CorpusCache {
  df: Map<string, number>;
  N: number;
  timestamp: number;
}

let corpusCache: CorpusCache | null = null;
const CORPUS_TTL_MS = 5 * 60 * 1000;

async function buildCorpusDf(): Promise<{ df: Map<string, number>; N: number }> {
  if (corpusCache && Date.now() - corpusCache.timestamp < CORPUS_TTL_MS) {
    return { df: corpusCache.df, N: corpusCache.N };
  }
  const uid = getAuth().currentUser?.uid ?? getOrCreateGuestId();
  const docs = await LocalDocumentService.getGuestDocuments(uid);
  const df = new Map<string, number>();
  for (const doc of docs) {
    try {
      const text = await LocalVersionService.getLatestContent(doc.id);
      const tokens = text.toLowerCase().match(TOKENIZER_RE) || [];
      const unique = new Set<string>();
      for (const w of tokens) {
        if (!STOP_WORDS.has(w)) unique.add(w);
      }
      for (const w of unique) {
        df.set(w, (df.get(w) || 0) + 1);
      }
    } catch {
      // skip doc on read error
    }
  }
  const result = { df, N: docs.length };
  corpusCache = { ...result, timestamp: Date.now() };
  return result;
}

export interface SaveData {
  title: string;
  tags: string[];
  labelId?: string | undefined;
  mood?: string | undefined;
}

function CelebrationBadge({ reduced }: { reduced: boolean }) {
  if (reduced) {
    return (
      <div className="flex items-center justify-center mb-3">
        <div className="w-12 h-12 rounded-full bg-accent-success/15 flex items-center justify-center">
          <Check size={24} className="text-accent-success" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center mb-3">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-accent-success/40 celebration-ring" />
        <span className="absolute inset-0 rounded-full border-2 border-accent-success/30 celebration-ring" style={{ animationDelay: '150ms' }} />
        <span className="absolute inset-0 rounded-full border-2 border-accent-success/20 celebration-ring" style={{ animationDelay: '300ms' }} />
        <div className="celebration-checkmark w-10 h-10 rounded-full bg-accent-success/15 flex items-center justify-center">
          <Check size={22} className="text-accent-success" />
        </div>
      </div>
    </div>
  );
}

async function computeLocalEcho(content: string, docId: string): Promise<string> {
  try {
    const { getLocalDb } = await import('../../../core/storage/localDb');
    const db = await getLocalDb();
    const emb = await db.get('aiEmbeddings', docId);
    let vector = emb?.vectors?.[0];
    if (!vector) {
      const { AIService } = await import('../../ai/services/AIService');
      const res = await AIService.embed({ content: content.slice(0, 1000) });
      vector = res.ok && res.vectors[0] ? res.vectors[0] : undefined;
    }
    if (!vector) {
      return '';
    }

    const timeline = await db.getAll('aiTimeline');
    const historical = timeline.filter(e => e.documentId !== docId);
    if (historical.length === 0) {
      return '';
    }

    const { cosineSimilarity } = await import('../../ai/utils/vectorSearch');
    let bestEntry = null;
    let bestScore = -1;
    for (const entry of historical) {
      const histEmb = await db.get('aiEmbeddings', entry.documentId);
      const histVector = histEmb?.vectors?.[0];
      if (histVector) {
        const score = cosineSimilarity(vector, histVector);
        if (score > bestScore) {
          bestScore = score;
          bestEntry = entry;
        }
      }
    }

    if (bestEntry && bestScore >= 0.7) {
      const date = new Date(bestEntry.date);
      const days = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];
      const dayName = days[date.getDay()] ?? 'прошлых днях';
      const theme = bestEntry.themes?.[0] || 'важных темах';
      return `Похоже на твои записи от ${dayName} о "${theme}"`;
    }
  } catch (e) {
    console.error(e);
  }
  // No genuine semantic match — return nothing rather than fabricate a connection.
  return '';
}

interface WritingFinishModalProps {
  isOpen: boolean;
  tags: string[];
  setTags: (tags: string[]) => void;
  labelId?: string | undefined;
  setLabelId: (labelId?: string) => void;
  labels: Label[];
  onSave: (data: SaveData) => Promise<string | null>;
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
  const navigate = useNavigate();
  const { execute, isLoading: isSaving } = useServiceAction();
  const { layoutMode } = useLayoutMode();
  const isMobile = layoutMode === 'mobile';


  const { wordCount, initialWordCount, content, title, setTitle, wpmHistory } = useContentStore(useShallow(s => ({
    wordCount: s.wordCount,
    initialWordCount: s.initialWordCount,
    content: s.content,
    title: s.title,
    setTitle: s.setTitle,
    wpmHistory: s.wpmHistory,
  })));
  const { seconds, sessionStartSeconds, accumulatedDuration, totalPauseSeconds, wordGoalReached, timeGoalReached } = useTimerStore(useShallow(s => ({
    seconds: s.seconds,
    sessionStartSeconds: s.sessionStartSeconds,
    accumulatedDuration: s.accumulatedDuration,
    totalPauseSeconds: s.totalPauseSeconds,
    wordGoalReached: s.wordGoalReached,
    timeGoalReached: s.timeGoalReached,
  })));
  const sessionSeconds = accumulatedDuration + Math.max(0, seconds - sessionStartSeconds);
  const totalElapsedSeconds = sessionSeconds + totalPauseSeconds;

  const sessionWords = Math.max(0, wordCount - initialWordCount);
  const avgWpm = sessionSeconds > 0
    ? Math.round((sessionWords / sessionSeconds) * 60)
    : 0;
  const readingMinutes = readingTimeMinutes(wordCount || sessionWords);

  const animWords = useCountUp(wordCount);
  const animSeconds = useCountUp(totalPauseSeconds > 0 ? totalElapsedSeconds : sessionSeconds);
  const animWpm = useCountUp(avgWpm);

  useModalEscape(isOpen, onCancel);
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, isOpen);

  const tagInputRef = React.useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'form' | 'mood'>('form');
  const [saveDataState, setSaveDataState] = useState<SaveData | null>(null);
  const [selectedMood, setSelectedMood] = useState<string | undefined>(undefined);
  const [echoText, setEchoText] = useState('');
  const savedDocIdRef = useRef<string | null>(null);

  // Echo ("Связь мыслей") is computed locally from the draft when we reach the
  // mood step, and only shown when there is a genuine semantic match with past
  // notes — otherwise nothing (no fabricated "перекликается" line).
  React.useEffect(() => {
    if (step !== 'mood') return;
    let cancelled = false;
    setEchoText('');
    void (async () => {
      try {
        const echo = await computeLocalEcho(content, savedDocumentId || '');
        if (!cancelled) setEchoText(echo);
      } catch {
        /* no echo on error */
      }
    })();
    return () => { cancelled = true; };
  }, [step, content, savedDocumentId]);

  const [statsExpanded, setStatsExpanded] = useState(true);
  const [formExpanded, setFormExpanded] = useState(true);
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [exportExpanded, setExportExpanded] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setStep('form');
      setSaveDataState(null);
      setSelectedMood(undefined);
    }
  }, [isOpen]);

  const goalReached = wordGoalReached || timeGoalReached;
  const [showCelebration, setShowCelebration] = useState(false);

  React.useEffect(() => {
    if (isOpen && goalReached) {
      setShowCelebration(true);
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(30);
        } catch {
          // ignore
        }
      }
    } else {
      setShowCelebration(false);
    }
  }, [isOpen, goalReached]);

  const [editTitle, setEditTitle] = useState('');
  const titleInputValue = editTitle || title || '';

  const [popularWords, setPopularWords] = useState<string[]>([]);

  const fallbackPopularWords = React.useMemo(() => {
    if (!isOpen) return [];
    const words = content.toLowerCase().match(TOKENIZER_RE) || [];
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

  React.useEffect(() => {
    if (!isOpen || !content) {
      setPopularWords([]);
      return;
    }
    let cancelled = false;
    setPopularWords(fallbackPopularWords);
    void (async () => {
      try {
        const { df, N } = await buildCorpusDf();
        if (cancelled || N === 0) return;
        const words = content.toLowerCase().match(TOKENIZER_RE) || [];
        const freq: Record<string, number> = {};
        words.forEach(w => {
          if (!STOP_WORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
        });
        const scored = Object.entries(freq)
          .map(([word, tf]) => {
            const idf = Math.log((N + 1) / ((df.get(word) || 0) + 1)) + 1;
            return { word, weight: tf * idf };
          })
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 5)
          .map(s => s.word);
        if (!cancelled) setPopularWords(scored);
      } catch {
        // fallback already set
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, content, fallbackPopularWords]);

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

  // Terminal action for the combined mood+echo step: saves with the chosen mood,
  // then either closes or hops into the chat with the note attached.
  const handleFinish = (discuss: boolean) => {
    if (!saveDataState) return;
    void execute(
      async () => {
        const docId = await onSave({ ...saveDataState, mood: selectedMood });
        savedDocIdRef.current = docId ?? null;
      },
      {
        successMessage: t('save_success'),
        errorMessage: t('error_save_failed'),
        onSuccess: () => {
          const docId = savedDocIdRef.current;
          onCancel();
          if (discuss && docId) void navigate(`/ai?doc=${docId}`);
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
                  aria-pressed={selectedMood === item.emoji}
                  whileHover={reducedMotion ? {} : { scale: 1.3 }}
                  whileTap={reducedMotion ? {} : { scale: 0.85 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                  initial={reducedMotion ? {} : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: i * 0.06 } }}
                  disabled={isSaving}
                  onClick={() => setSelectedMood(m => m === item.emoji ? undefined : item.emoji)}
                  className={cn(
                    "text-4xl rounded-full transition-all",
                    selectedMood === item.emoji ? "scale-110 drop-shadow-[0_0_10px_var(--brand-soft)]" : selectedMood ? "opacity-40" : "",
                    isSaving && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {item.emoji}
                </motion.button>
              ))}
            </div>

            {/* Echo — only rendered when there's a genuine match with past notes */}
            {echoText && (
              <div className="flex items-center gap-2.5 text-left max-w-sm mx-auto bg-surface-base/10 border border-border-subtle/50 px-4 py-3 rounded-2xl">
                <Sparkles className="text-brand-soft shrink-0" size={16} />
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-soft/80">Связь мыслей</div>
                  <div className="text-xs text-text-main/80 leading-relaxed italic">{echoText}</div>
                </div>
              </div>
            )}

            <div className="pt-2 flex flex-col gap-2.5">
              <Button
                variant="primary"
                size="md"
                isLoading={isSaving}
                onClick={() => handleFinish(false)}
                className="w-full max-w-xs mx-auto"
              >
                {isSaving ? t('finish_saving') : t('finish_done')}
              </Button>
              <Button
                variant="ghost"
                size="md"
                disabled={isSaving}
                onClick={() => handleFinish(true)}
                className="w-full max-w-xs mx-auto flex items-center justify-center gap-2 bg-brand-soft/10 text-brand-soft border border-brand-soft/20 hover:bg-brand-soft/20 font-bold"
              >
                <Sparkles size={14} />
                {t('finish_discuss_ai')}
              </Button>
            </div>
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
              {showCelebration && <CelebrationBadge reduced={!!reducedMotion} />}
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
                readingMinutes={readingMinutes}
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
                  disabled={wordCount === 0}
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
            {showCelebration && <CelebrationBadge reduced={!!reducedMotion} />}
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
            readingMinutes={readingMinutes}
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
              disabled={wordCount === 0}
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
