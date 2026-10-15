import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Sparkles, Check, X } from 'lucide-react';

import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../../core/utils/utils';
import { Label } from '../../../types';
import { useLanguage } from '../../../shared/i18n';
import { useCountUp } from '../../../shared/hooks/useCountUp';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSaveMomentStore } from '../store/useSaveMomentStore';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useWritingSettings } from '../../../core/settings/WritingSettingsContext';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { useNavigate } from 'react-router-dom';
import { FinishModalStats } from './FinishModalStats';
import { FinishModalTags } from './FinishModalTags';
import { Button } from '../../../shared/components/Button';
import { IconButton } from '../../../shared/components/IconButton';
import { useToast } from '../../../shared/components/Toast';
import { ModalShell } from '../../../shared/components/ModalShell';
import { readingTimeMinutes } from '../../../shared/utils/readingTime';
import { suggestExistingTags } from '../utils/tagSuggestions';
import { LocalDocumentService } from '../../../core/services/LocalDocumentService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { getOrCreateGuestId } from '../../../core/storage/localDb';
import { getCurrentUser } from '../../../core/auth';
import { cloudSyncEnabled } from '../../../core/sync/cloudSyncEnabled';

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
  const uid = getCurrentUser()?.uid ?? getOrCreateGuestId();
  const docs = await LocalDocumentService.getDocumentsByOwner(uid);
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

async function computeLocalEcho(content: string, docId: string, t?: (key: string, params?: Record<string, string | number>) => string): Promise<string> {
  try {
    const { getLocalDb } = await import('../../../core/storage/localDb');
    const db = await getLocalDb();
    const emb = await db.get('aiEmbeddings', docId);
    // Только уже посчитанный вектор. Раньше здесь при его отсутствии
    // вычислялся новый — то есть завершение сессии само отправляло начало
    // заметки поставщику ИИ, без спроса. Нет вектора — нет эха: заметка
    // получит его, когда её разберут нажатием ✨.
    const vector = emb?.vectors?.[0];
    if (!vector) {
      return '';
    }

    const timeline = await db.getAll('aiTimeline');
    const historical = timeline.filter(e => e.documentId !== docId);
    if (historical.length === 0) {
      return '';
    }

    const { cosineSimilarity } = await import('../../../shared/utils/vectorMath');
    let bestEntry = null;
    let bestScore = -1;
    // EA-12: один проход по векторам вместо запроса на каждую запись истории.
    const embByDoc = new Map((await db.getAll('aiEmbeddings')).map(e => [e.documentId, e]));
    for (const entry of historical) {
      const histEmb = embByDoc.get(entry.documentId);
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
      const isRu = !t || t('finish_echo_title') === 'Связь мыслей';
      const dayName = date.toLocaleDateString(isRu ? 'ru-RU' : 'en-US', { weekday: 'long' });
      const theme = bestEntry.themes?.[0] || (t ? t('finish_echo_default_theme') : 'важных темах');
      return t ? t('finish_echo_similar', { day: dayName, theme }) : `Похоже на твои записи от ${dayName} о "${theme}"`;
    }
  } catch (e) {
    console.error(e);
  }
  // No genuine semantic match — return nothing rather than fabricate a connection.
  return '';
}

interface WritingFinishModalProps {
  isOpen: boolean;
  tags?: string[];
  setTags?: (tags: string[]) => void;
  labelId?: string | undefined;
  setLabelId?: (labelId?: string) => void;
  labels?: Label[];
  onSave: (data: SaveData) => Promise<string | null | { docId: string | null; cloudSynced: boolean; isTooLarge?: boolean }>;
  onCancel: () => void;
  onSkipSave?: () => void;
  streakDays?: number | undefined;
  sessionGroups?: { date: Date; sessions: unknown[] }[] | undefined;
  savedDocumentId?: string | null | undefined;
}

export interface SessionFinishStatsInput {
  accumulatedDuration: number;
  seconds: number;
  sessionStartSeconds: number;
  initialDuration: number;
  wordCount: number;
  initialWordCount: number;
  totalPauseSeconds?: number;
}

export interface SessionFinishStats {
  totalAccumulatedSeconds: number;
  sessionSeconds: number;
  totalElapsedSeconds: number;
  sessionWords: number;
  avgWpm: number;
}

export function calculateSessionFinishStats(input: SessionFinishStatsInput): SessionFinishStats {
  const totalAccumulatedSeconds = input.accumulatedDuration + Math.max(0, input.seconds - input.sessionStartSeconds);
  const sessionSeconds = Math.max(0, totalAccumulatedSeconds - input.initialDuration);
  const totalElapsedSeconds = sessionSeconds + (input.totalPauseSeconds ?? 0);
  const sessionWords = Math.max(0, input.wordCount - input.initialWordCount);
  const avgWpm = sessionSeconds > 0
    ? Math.round((sessionWords / sessionSeconds) * 60)
    : 0;
  return {
    totalAccumulatedSeconds,
    sessionSeconds,
    totalElapsedSeconds,
    sessionWords,
    avgWpm,
  };
}

// DC-W3: заголовок итогов — одна строка о том, что получилось, а не «Сессия
// завершена». В «Писать без цифр» (DC-W2) и при нуле слов — только «Записано.».
export function buildFinishHeading(input: {
  sessionWords: number;
  sessionSeconds: number;
  quietStats: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
  tp: (key: string, count: number) => string;
}): string {
  if (input.quietStats || input.sessionWords <= 0) return input.t('finish_written_bare');
  const minutes = Math.floor(input.sessionSeconds / 60);
  const time = minutes < 1
    ? input.t('finish_duration_under_minute')
    : input.tp('duration_minutes', minutes);
  return input.t('finish_written_heading', {
    words: input.tp('archive_word_count', input.sessionWords),
    time,
  });
}

// 😖 вместо 🤢: старые заметки хранят 🤢, он остался валидным (VALID_MOOD_EMOJIS)
// и считается тем же настроением в MoodTrend.
const MOOD_OPTIONS: { emoji: string; key: string }[] = [
  { emoji: '😊', key: 'mood_happy' },
  { emoji: '😢', key: 'mood_sad' },
  { emoji: '😠', key: 'mood_anger' },
  { emoji: '😨', key: 'mood_fear' },
  { emoji: '😖', key: 'mood_disgust' },
  { emoji: '🤔', key: 'mood_interest' },
];

function MoodRow({
  quiet = false,
  selectedMood,
  onSelect,
  disabled,
  echoText,
  t,
}: {
  /** SA-24: телефон — подписи 12 px `--text-muted` без обёрток с opacity (контраст ≥ 4.5:1). */
  quiet?: boolean;
  selectedMood: string | undefined;
  onSelect: (mood: string | undefined) => void;
  disabled: boolean;
  echoText: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <div className="space-y-2.5">
      <div className={cn('flex items-baseline justify-center gap-1.5', quiet ? 'text-[12px] text-text-muted' : 'text-label-sm text-text-main/60')}>
        <span>{t('mood_checkin_title')}</span>
        <span className={quiet ? undefined : 'text-text-main/40'}>· {t('mood_optional_hint')}</span>
      </div>
      {/* SA-24: с подписями 12 px шесть настроений в одну строку не влезают в 360 px (живой снимок:
          «дость», «Интер» за краем) — на телефоне сетка 3×2. */}
      <div className={quiet ? 'mx-auto grid max-w-xs grid-cols-3 gap-y-1' : 'flex justify-center gap-1'}>
        {MOOD_OPTIONS.map((item) => {
          const active = selectedMood === item.emoji;
          return (
            <button
              key={item.emoji}
              type="button"
              aria-label={t(item.key)}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onSelect(active ? undefined : item.emoji)}
              className={cn(
                'press flex flex-col items-center gap-1 rounded-xl px-2 py-1.5 transition-colors hover:bg-text-main/5',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              <span
                className={cn(
                  'text-2xl leading-none transition-[scale,opacity,filter] duration-150 ease-out',
                  active ? 'scale-110 drop-shadow-[0_0_10px_var(--brand-soft)]' : selectedMood ? 'opacity-40' : ''
                )}
              >
                {item.emoji}
              </span>
              <span className={cn(
                'whitespace-nowrap',
                quiet ? 'text-[12px]' : 'text-[10px]',
                active ? 'text-text-main' : quiet ? 'text-text-muted' : 'text-text-main/50',
              )}>
                {t(item.key)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Echo — only rendered when there's a genuine match with past notes */}
      {echoText && (
        <div className="flex items-center gap-2.5 text-left max-w-sm mx-auto bg-surface-base/10 border border-border-subtle/50 px-4 py-3 rounded-2xl">
          <Sparkles className="text-brand-soft shrink-0" size={16} />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-brand-soft/80">{t('finish_echo_title')}</div>
            <div className="text-xs text-text-main/80 leading-relaxed italic">{echoText}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function FinishActions({
  isSaving,
  canSave,
  isMobile,
  onSave,
  onDiscuss,
  onBack,
  onLater,
  t,
}: {
  isSaving: boolean;
  canSave: boolean;
  isMobile: boolean;
  onSave: () => void;
  onDiscuss: () => void;
  onBack: () => void;
  onLater: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const ghost = isMobile
    ? 'flex-1 px-3 py-3.5 rounded-2xl border border-border-subtle text-text-main hover:bg-text-main/5 min-h-[44px] text-sm font-bold'
    : 'flex-1 px-3 py-3.5 rounded-2xl border border-border-subtle text-text-main hover:bg-white/5 text-sm font-bold';
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost" size="md" onClick={onBack} className={ghost}>
        {t('finish_back')}
      </Button>
      <Button variant="ghost" size="md" onClick={onLater} title={t('finish_save_later_hint')} className={cn(ghost, 'text-text-main/70')}>
        {t('finish_save_later')}
      </Button>
      <Button
        variant="ghost"
        size="md"
        disabled={isSaving}
        onClick={onDiscuss}
        className={cn(ghost, 'flex items-center justify-center gap-2 bg-brand-soft/10 text-brand-soft border-brand-soft/20 hover:bg-brand-soft/20')}
      >
        <Sparkles size={14} />
        {t('finish_discuss_ai')}
      </Button>
      <Button
        variant="primary"
        size="md"
        onClick={onSave}
        isLoading={isSaving}
        disabled={!canSave}
        className={cn(
          'flex-[1.4] px-3 py-3.5 font-bold rounded-2xl shadow-[0_0_20px_var(--brand-soft)]/30 text-sm',
          isMobile && 'min-h-[44px]'
        )}
      >
        {isSaving ? t('finish_saving') : t('common_save')}
      </Button>
    </div>
  );
}

// Закрытое окно не монтирует тело: иначе оно подписано на текст, таймер и
// счётчики и крутит анимацию цифр на каждой секунде и каждом слове — лишние
// перерисовки экрана письма (EA-9). Черновик заголовка живёт здесь, чтобы, как
// и раньше, переживать «Отмену» и повторное открытие.
export function WritingFinishModal(props: WritingFinishModalProps) {
  const [editTitle, setEditTitle] = useState('');
  // MF-20 (SA-6): после закрытия тело живёт ещё 250 мс — лист успевает уйти
  // вниз, а не исчезнуть за кадр; потом размонтируется, как требует EA-9.
  const [lingering, setLingering] = useState(false);
  const [wasOpen, setWasOpen] = useState(props.isOpen);
  if (wasOpen !== props.isOpen) {
    setWasOpen(props.isOpen);
    setLingering(!props.isOpen);
  }
  useEffect(() => {
    if (!lingering) return;
    const id = setTimeout(() => setLingering(false), 250);
    return () => clearTimeout(id);
  }, [lingering]);
  if (!props.isOpen && !lingering) return null;
  return <WritingFinishModalBody {...props} editTitle={editTitle} setEditTitle={setEditTitle} />;
}

function WritingFinishModalBody({
  editTitle,
  setEditTitle,
  isOpen,
  tags = [],
  setTags = () => {},
  labelId,
  setLabelId = () => {},
  labels = [],
  onSave,
  onCancel,
  onSkipSave = () => {},
  streakDays = 0,
  sessionGroups = [],
  savedDocumentId,
}: WritingFinishModalProps & { editTitle: string; setEditTitle: (v: string) => void }) {
  const { t, tp } = useLanguage();
  const { showToast } = useToast();
  const { quietStats } = useWritingSettings();
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
  const { seconds, sessionStartSeconds, accumulatedDuration, initialDuration, totalPauseSeconds, wordGoalReached, timeGoalReached } = useTimerStore(useShallow(s => ({
    seconds: s.seconds,
    sessionStartSeconds: s.sessionStartSeconds,
    accumulatedDuration: s.accumulatedDuration,
    initialDuration: s.initialDuration,
    totalPauseSeconds: s.totalPauseSeconds,
    wordGoalReached: s.wordGoalReached,
    timeGoalReached: s.timeGoalReached,
  })));
  const {
    totalAccumulatedSeconds,
    sessionSeconds,
    totalElapsedSeconds,
    sessionWords,
    avgWpm,
  } = calculateSessionFinishStats({
    accumulatedDuration,
    seconds,
    sessionStartSeconds,
    initialDuration,
    wordCount,
    initialWordCount,
    totalPauseSeconds,
  });
  const readingMinutes = readingTimeMinutes(wordCount || sessionWords);

  const animWords = useCountUp(sessionWords);
  const animSeconds = useCountUp(totalPauseSeconds > 0 ? totalElapsedSeconds : sessionSeconds);
  const animWpm = useCountUp(avgWpm);

  const tagInputRef = React.useRef<HTMLInputElement>(null);
  const [selectedMood, setSelectedMood] = useState<string | undefined>(undefined);
  const [echoText, setEchoText] = useState('');
  const savedDocIdRef = useRef<string | null>(null);
  const savedCloudSyncedRef = useRef<boolean>(true);
  const savedIsTooLargeRef = useRef<boolean>(false);

  // Echo ("Связь мыслей") считается локально по черновику и показывается, только
  // когда есть настоящее смысловое совпадение с прошлыми заметками — иначе ничего
  // (никаких выдуманных «перекликается»).
  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear previous echo before asynchronous computation
    setEchoText('');
    void (async () => {
      try {
        const echo = await computeLocalEcho(content, savedDocumentId || '', t);
        if (!cancelled) setEchoText(echo);
      } catch {
        /* no echo on error */
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, content, savedDocumentId, t]);

  const [statsExpanded, setStatsExpanded] = useState(true);
  const [formExpanded, setFormExpanded] = useState(true);
  const [tagsExpanded, setTagsExpanded] = useState(true);

  React.useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset mood selection on open
      setSelectedMood(undefined);
    }
  }, [isOpen]);

  const goalReached = wordGoalReached || timeGoalReached;
  const showCelebration = Boolean(isOpen && goalReached);

  React.useEffect(() => {
    if (isOpen && goalReached) {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(30);
        } catch {
          // ignore
        }
      }
    }
  }, [isOpen, goalReached]);

  const titleInputValue = editTitle || title || '';

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

  const [tfidfWords, setTfidfWords] = useState<string[] | null>(null);

  React.useEffect(() => {
    if (!isOpen || !content) {
      return;
    }
    let cancelled = false;
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
        if (!cancelled) setTfidfWords(scored);
      } catch {
        // fallback already available
      }
    })();
    return () => {
      cancelled = true;
      setTfidfWords(null);
    };
  }, [isOpen, content]);

  const popularWords = tfidfWords ?? fallbackPopularWords;

  // SA-24: на телефоне — только уже существующие теги человека, совпавшие с текстом, не больше двух.
  const [userTags, setUserTags] = useState<string[]>([]);
  React.useEffect(() => {
    if (!isOpen || !isMobile) return;
    let cancelled = false;
    void (async () => {
      try {
        const uid = getCurrentUser()?.uid ?? getOrCreateGuestId();
        const docs = await LocalDocumentService.getDocumentsByOwner(uid);
        if (!cancelled) setUserTags(Array.from(new Set(docs.flatMap(d => d.tags ?? []))));
      } catch {
        // без подсказок — не беда
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, isMobile]);

  const allSuggestions = React.useMemo(() => {
    if (isMobile) return suggestExistingTags(content, userTags);
    const suggestions = new Set([(title || '').trim(), ...popularWords].filter(Boolean));
    return Array.from(suggestions);
  }, [isMobile, content, userTags, title, popularWords]);

  const reducedMotion = useReducedMotion();
  const slideTransition = { duration: 0.22, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] };

  // MQ-5: тело не возвращает null при !isOpen — им владеет обёртка, которая держит его
  // ещё 250 мс, пока ModalShell проигрывает уход (ранний return убивал этот уход, MF-20).
  const finalTitle = titleInputValue.trim() || title || '';
  const heading = buildFinishHeading({ sessionWords, sessionSeconds, quietStats, t, tp });

  // MC-3: на телефоне под заголовком — одна тихая строка из тех же кусочков, что
  // и заголовок (тикет просит переиспользовать `finish_written_heading`), и эхо
  // первой фразы текста.
  const finishSubline = sessionWords > 0
    ? [
      tp('archive_word_count', sessionWords),
      sessionSeconds < 60 ? t('finish_duration_under_minute') : tp('duration_minutes', Math.floor(sessionSeconds / 60)),
      t('reading_time', { n: readingMinutes }),
    ].join(' · ')
    : '';
  const firstSentence = (() => {
    const plain = content.replace(/\s+/g, ' ').trim();
    if (!plain) return '';
    const match = plain.match(/[^.!?…]+[.!?…]/);
    return (match ? match[0] : plain).slice(0, 180).trim();
  })();

  // Одно действие на все кнопки: сохранить (с выбранным настроением) и, по желанию,
  // сразу уйти обсуждать заметку в чат. Второго шага с настроением больше нет.
  const finishSave = (discuss: boolean) => {
    const pendingTag = tagInputRef.current?.value.trim();
    const finalTags = pendingTag && !tags.includes(pendingTag)
      ? [...tags, pendingTag]
      : tags;
    if (tagInputRef.current) tagInputRef.current.value = '';
    if (finalTags !== tags) setTags(finalTags);

    if (finalTitle && finalTitle !== title) {
      setTitle(finalTitle);
    }

    void execute(
      async () => {
        const saveRes = await onSave({ title: finalTitle, tags: finalTags, labelId, mood: selectedMood });
        const docId = typeof saveRes === 'object' && saveRes !== null ? saveRes.docId : saveRes;
        const cloudSynced = typeof saveRes === 'object' && saveRes !== null ? saveRes.cloudSynced : true;
        const isTooLarge = typeof saveRes === 'object' && saveRes !== null && 'isTooLarge' in saveRes ? Boolean(saveRes.isTooLarge) : false;
        savedDocIdRef.current = docId ?? null;
        savedCloudSyncedRef.current = cloudSynced;
        savedIsTooLargeRef.current = isTooLarge;
      },
      {
        errorMessage: t('error_save_failed'),
        onSuccess: () => {
          const docId = savedDocIdRef.current;
          const cloudSynced = savedCloudSyncedRef.current;
          const isTooLarge = savedIsTooLargeRef.current;
          const currentUid = getCurrentUser()?.uid ?? getOrCreateGuestId();
          onCancel();
          // MC-4 (поправка ревьюера): с «Сохранить» уходят четыре тоста. Успех на
          // телефоне заменяется тихой строкой в шапке письма, а три случая
          // «ещё не в облаке» обязаны остаться видимыми — теми же словами, но
          // предупреждением и дольше (3 с вместо 1,2 с).
          const warningText = cloudSynced
            ? null
            : isTooLarge
              ? t('save_too_large_cloud_warning')
              : (currentUid.startsWith('guest_') || !cloudSyncEnabled(currentUid))
                // D-12 / D-22: у гостя облака нет вовсе, а при выключенной
                // автосинхронизации в облако не уходит ничего — обещать
                // «отправится позже» нельзя.
                ? t('save_local_device_only')
                : t('save_local_only_queued');
          if (isMobile) {
            useSaveMomentStore.getState().announce({
              words: sessionWords,
              streakDays,
              warningText,
              text: content,
            });
            navigator.vibrate?.(12);
            // Ревью 0.9.40: «Обсудить с ИИ» уводит на /ai, и строка экрана письма
            // не видна — предупреждение «не в облаке» уходит обычным тостом.
            if (discuss && warningText !== null) showToast(warningText, isTooLarge ? 'warning' : undefined);
          } else if (warningText === null) {
            showToast(t('save_success'), 'success');
          } else if (isTooLarge) {
            showToast(warningText, 'warning');
          } else {
            showToast(warningText);
          }
          if (discuss && docId) void navigate(`/ai?doc=${docId}`);
        },
      }
    );
  };

  return (
    <ModalShell
      open={isOpen}
      onClose={onCancel}
      labelId="finish-modal-title"
      variant={isMobile ? 'sheet' : 'modal'}
      fullHeight={isMobile}
      className={cn(
        "bg-surface-card text-text-main",
        isMobile
          ? "finish-sheet-full flex flex-col overflow-hidden"
          : "shadow-[0_0_60px_rgba(0,0,0,0.8)] rounded-3xl p-8 max-h-[90vh] overflow-y-auto no-scrollbar border border-border-subtle h-auto"
      )}
    >
        <AnimatePresence mode="wait" initial={false}>
        {isMobile ? (
          <motion.div
            key="form"
            initial={reducedMotion ? {} : { opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? {} : { opacity: 0, y: 40 }}
            transition={slideTransition}
            className="flex-1 flex flex-col overflow-hidden"
          >
            {/* MC-3: одна строка сверху — «×» (= «Вернуться к тексту»), и всё. */}
            <div className="flex items-start justify-end gap-2 px-3 pt-2 shrink-0">
              {showCelebration && <CelebrationBadge reduced={!!reducedMotion} />}
              <IconButton
                onClick={onCancel}
                className="h-11 w-11 rounded-full text-text-main/60"
                label={t('close')}
                icon={<X size={22} aria-hidden="true" />}
              />
            </div>

            <div className="custom-scrollbar flex-1 overflow-y-auto px-5">
              <h3 id="finish-modal-title" className="font-serif text-[32px] font-medium leading-[1.15] text-text-main">
                {t('finish_written_bare')}
              </h3>
              {finishSubline && (
                <p className="mt-1 text-[15px] leading-[1.4] text-text-muted">{finishSubline}</p>
              )}
              {/* MF-6: курсивной первой фразы нет — она уже в подсказке поля названия. */}

              <div className="mt-6">
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
                  layout="plain"
                  titlePlaceholder={firstSentence.slice(0, 40)}
                  tagsExpanded={tagsExpanded}
                  setTagsExpanded={setTagsExpanded}
                  formExpanded={formExpanded}
                  setFormExpanded={setFormExpanded}
                  titleInputValue={titleInputValue}
                  setEditTitle={setEditTitle}
                />
              </div>

              {/* Владелец: настроение остаётся, но тихой строкой. */}
              <div className="mt-6">
                <MoodRow
                  quiet
                  selectedMood={selectedMood}
                  onSelect={setSelectedMood}
                  disabled={isSaving}
                  echoText={echoText}
                  t={t}
                />
              </div>
            </div>

            <div className="shrink-0 px-5 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={onSkipSave}
                  title={t('finish_save_later_hint')}
                  className="min-h-11 px-2 text-[14px] text-text-muted"
                >
                  {t('finish_save_later')}
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  disabled={isSaving}
                  onClick={() => void finishSave(true)}
                  className="min-h-11 gap-1.5 px-2 text-[14px] text-brand-soft"
                >
                  {t('finish_discuss_ai')}
                  <span aria-hidden="true">→</span>
                </Button>
              </div>
              <Button
                variant="primary"
                size="lg"
                onClick={() => void finishSave(false)}
                isLoading={isSaving}
                disabled={wordCount <= 0}
                className="mt-2 h-[52px] w-full rounded-2xl text-[16px] font-semibold"
              >
                {t('common_save')}
              </Button>
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
            <h3 id="finish-modal-title" className="text-2xl font-bold text-text-main">{heading}</h3>
          </div>

          {!quietStats && (
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
            tp={tp}
            isMobile={isMobile}
            statsExpanded={statsExpanded}
            setStatsExpanded={setStatsExpanded}
            totalWords={wordCount}
            totalDuration={totalAccumulatedSeconds}
          />
          )}

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

          <MoodRow
            selectedMood={selectedMood}
            onSelect={setSelectedMood}
            disabled={isSaving}
            echoText={echoText}
            t={t}
          />

          <FinishActions
            isSaving={isSaving}
            canSave={wordCount > 0}
            isMobile={isMobile}
            onSave={() => finishSave(false)}
            onDiscuss={() => finishSave(true)}
            onBack={onCancel}
            onLater={onSkipSave}
            t={t}
          />
        </motion.div>
        )}
        </AnimatePresence>
    </ModalShell>
  );
}
