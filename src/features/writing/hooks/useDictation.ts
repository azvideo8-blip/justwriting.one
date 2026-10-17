import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLanguage } from '../../../shared/i18n';
import { useToast } from '../../../shared/components/Toast';
import { useMicLevel } from '../../../shared/hooks/useMicLevel';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { appendDictation } from './appendDictation';
import { useGuardedSpeechInput } from './useGuardedSpeechInput';

// D-4: одна сессия диктовки на экран.
//
// Кнопок микрофона три (Toolbar в шапке, MobileWriteToolbar, BottomStats), и на
// десктопе две из них видны одновременно. Если каждая владеет своим
// распознаванием, человек получает два движка и две панели записи. Поэтому
// первый заявившийся экземпляр становится хостом: он владеет движком и публикует
// снимок в модульный стор, остальные читают этот снимок и передают команды хосту.
// Экран с единственной кнопкой (в том числе тест одной кнопки) получает хостом её
// саму — поведение не меняется.
//
// Пунктуация приходит извне (registerDictationAi): writing не может импортировать
// features/ai — граница стоит в eslint-зоне no-restricted-paths. Реализацию
// подключает app-слой (src/app/dictationAiWiring.ts). Без неё диктовка
// остаётся такой, какой была до D-3: текст вставляется как сказан, без знаков,
// без тоста и без ИИ-метки.

/** Таймаут запроса пунктуации. GEN_TIMEOUT_MS в AIService (115 с) здесь ни при
 *  чём: текст уже есть, и держать человека без него дольше пятнадцати секунд
 *  нельзя — по истечении вставляется исходник. */
export const DICTATION_PUNCTUATE_TIMEOUT_MS = 15_000;

/** Причины, о которых человек узнаёт тостом. Остальные (не вошёл, нет согласия,
 *  скрытая заметка, пусто, ИИ не подключён) — молчаливый путь: диктовку они не
 *  сломали. */
const TOAST_REASONS = new Set(['limit', 'offline', 'error', 'words-changed', 'too-long']);
const REASON_KEYS: Record<string, string> = {
  limit: 'voice_no_punctuation_reason_limit',
  offline: 'voice_no_punctuation_reason_offline',
  error: 'voice_no_punctuation_reason_error',
  'words-changed': 'voice_no_punctuation_reason_words_changed',
  'too-long': 'voice_no_punctuation_reason_too_long',
};

export interface DictationAiResult {
  text: string;
  punctuated: boolean;
  reason?: string | undefined;
}

export interface DictationAiDeps {
  punctuate: (raw: string, ctx: { documentId?: string | undefined }) => Promise<DictationAiResult>;
  willPunctuate: () => { yes: boolean; remaining: number };
  noteHidden: (documentId: string | undefined) => Promise<boolean>;
}

/** Диктовка без ИИ: текст вставляется как сказан, метки и предупреждения про
 *  запрос нет. Тот же путь — у невошедшего пользователя. */
const NO_AI: DictationAiDeps = {
  punctuate: async (raw: string) => ({ text: raw, punctuated: false, reason: 'no-ai' }),
  willPunctuate: () => ({ yes: false, remaining: 0 }),
  noteHidden: async () => true,
};

let aiDeps: DictationAiDeps = NO_AI;

export function registerDictationAi(deps: DictationAiDeps): void {
  aiDeps = deps;
}

/** FX-3: только чтение — подключён ли мостик writing → ai. Без него диктовка
 *  работает по-прежнему, но без пунктуации, и молчит. */
export function dictationAiIsWired(): boolean {
  return aiDeps !== NO_AI;
}

export type DictationPhase = 'idle' | 'recording' | 'processing';

export interface DictationSnapshot {
  isListening: boolean;
  phase: DictationPhase;
  liveText: string;
  interimText: string;
  level: number;
  /** Кольцевой буфер последних уровней (32 значения): волна рисуется по истории,
   *  а не по одному числу, иначе на паузе полоса просто гаснет. */
  levels: number[];
  levelFailed: boolean;
  seconds: number;
  aiNoticeRemaining: number | null;
  hasSupport: boolean;
  isVaultActive: boolean;
}

export interface DictationApi extends DictationSnapshot {
  toggle: () => void;
  /** MF-5: старт после листа «Голосовой ввод» (предупреждение уже показано). */
  startAfterNotice: () => void;
  stop: () => void;
  cancel: () => void;
}

const WAVE_LENGTH = 32;
const EMPTY_LEVELS: number[] = Array.from({ length: WAVE_LENGTH }, () => 0);

const IDLE: DictationSnapshot = {
  isListening: false,
  phase: 'idle',
  liveText: '',
  interimText: '',
  level: 0,
  levels: EMPTY_LEVELS,
  levelFailed: false,
  seconds: 0,
  aiNoticeRemaining: null,
  hasSupport: true,
  isVaultActive: false,
};

let snapshot: DictationSnapshot = IDLE;
// История уровня живёт в модульной переменной хоста (не в ref): в теле рендера
// ref читать нельзя (react-hooks/refs), а перерисовка всё равно случается по
// изменению meter.level.
let waveLevels: number[] = EMPTY_LEVELS;
let ownerToken: symbol | null = null;
const listeners = new Set<() => void>();
let hostCommands: { toggle: () => void; startAfterNotice: () => void; stop: () => void; cancel: () => void } | null = null;

function notify(): void {
  listeners.forEach(l => l());
}

function subscribeToStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function readSnapshot(): DictationSnapshot {
  return snapshot;
}

function readOwner(): symbol | null {
  return ownerToken;
}

export function useDictation(): DictationApi {
  const [token] = useState(() => Symbol('dictation-host'));
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [yielded, setYielded] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [aiNotice, setAiNotice] = useState<{ yes: boolean; remaining: number }>({ yes: false, remaining: 0 });

  const docIdRef = useRef<string | null>(null);
  // R7Q-008: пара «id заметки + идентификатор черновика». Одного id мало: у
  // двух разных несохранённых заметок он null, а сохранение черновика во время
  // пунктуации (null → id) — это та же заметка, а не смена.
  const targetRef = useRef<{ docId: string | null; nonce: string }>({ docId: null, nonce: '' });
  // Номер доставки: ответ ИИ, пришедший после таймаута или отмены, обязан быть
  // брошен, иначе текст вставится второй раз.
  const deliverySeqRef = useRef(0);
  const yieldedRef = useRef(false);
  const restartTriedRef = useRef(false);
  const meterActiveRef = useRef(false);
  const startRef = useRef<() => void>(() => undefined);
  // Сказанное к моменту автоотмены — чтобы отдать его человеку, а не выбросить.
  const liveTextRef = useRef('');

  const claimed = useSyncExternalStore(subscribeToStore, readOwner, readOwner);
  const isHost = claimed === token;

  // Ревью D (09.10): сказанное не пропадает молча и не уезжает в чужую заметку.
  // Текст отдаётся тостом с копированием — нажатие на кнопку и есть жест,
  // который разрешает запись в буфер обмена.
  const offerCopy = useCallback((text: string, messageKey: string) => {
    showToast(t(messageKey), 'warning', {
      label: t('voice_copy_text'),
      onClick: () => { void navigator.clipboard?.writeText(text).catch(() => undefined); },
    });
  }, [showToast, t]);

  // Пунктуация идёт до пятнадцати секунд после Stop, и человек успевает открыть
  // другую заметку: вставка обязана попасть туда, где начиналась запись.
  const deliverToStartNote = useCallback((text: string): boolean => {
    if (!sameDictationTarget(targetRef.current, useSessionMetaStore.getState())) {
      offerCopy(text, 'voice_not_inserted_note_changed');
      return false;
    }
    appendDictation(text);
    return true;
  }, [offerCopy]);

  const handleSessionEnd = useCallback((raw: string) => {
    if (!raw) return;
    const seq = ++deliverySeqRef.current;
    setProcessing(true);
    void (async () => {
      try {
        const result = await withTimeout(
          aiDeps.punctuate(raw, { documentId: docIdRef.current ?? undefined }),
          DICTATION_PUNCTUATE_TIMEOUT_MS,
        );
        if (seq !== deliverySeqRef.current) return;
        if (!deliverToStartNote(result.text || raw)) return;
        if (!result.punctuated && result.reason && TOAST_REASONS.has(result.reason)) {
          showToast(t('voice_no_punctuation_toast', { reason: t(REASON_KEYS[result.reason] ?? 'voice_no_punctuation_reason_error') }), 'info');
        }
      } catch {
        // Сюда приходит только таймаут (пунктуация сама не бросает): текст
        // вставляется как есть, и человек узнаёт, почему без знаков.
        if (seq !== deliverySeqRef.current) return;
        if (!deliverToStartNote(raw)) return;
        showToast(t('voice_no_punctuation_toast', { reason: t('voice_no_punctuation_reason_error') }), 'info');
      } finally {
        if (seq === deliverySeqRef.current) {
          setProcessing(false);
          setSeconds(0);
          setYielded(false);
          yieldedRef.current = false;
          restartTriedRef.current = false;
        }
      }
    })();
  }, [showToast, t, deliverToStartNote]);

  const handleRecognitionError = useCallback((error: string) => {
    // Guard двух потребителей: на части Android второй getUserMedia отнимает
    // микрофон у распознавания. Диктовка важнее волны — метр уступает один раз,
    // распознавание стартует без него.
    if (error !== 'audio-capture' && error !== 'not-allowed') return;
    if (yieldedRef.current || !meterActiveRef.current) return;
    yieldedRef.current = true;
    setYielded(true);
    if (!restartTriedRef.current) {
      restartTriedRef.current = true;
      startRef.current();
    }
  }, []);

  const session = useGuardedSpeechInput({
    onSessionEnd: handleSessionEnd,
    onError: handleRecognitionError,
  });

  // Видео владельца 2026-10-17: на iOS (любой браузер — это WebKit) волна через
  // getUserMedia молча отнимает микрофон у распознавания — ни ошибки, ни слов,
  // уступка выше не срабатывает. Там волны нет, вместо неё точка (D-4).
  const meterAllowed = !isIosWebKit();
  const meterActive = session.isListening && !yielded && meterAllowed;
  const meter = useMicLevel(meterActive);

  useEffect(() => {
    meterActiveRef.current = meterActive;
    startRef.current = session.startListening;
    liveTextRef.current = session.liveText;
  }, [meterActive, session]);

  // История уровня живёт в ref и обновляется из эффекта: в теле рендера ref
  // трогать нельзя, а state на каждый кадр плодит каскадные рендеры.
  useEffect(() => {
    waveLevels = [...waveLevels.slice(1), meter.level];
  }, [meter.level]);

  // Заявка на хостинг и её снятие.
  useEffect(() => {
    if (ownerToken === null) {
      ownerToken = token;
      notify();
    }
    return () => {
      if (ownerToken === token) {
        ownerToken = null;
        hostCommands = null;
        waveLevels = EMPTY_LEVELS;
        snapshot = IDLE;
        notify();
      }
    };
  }, [token]);

  // Хост публикует своё состояние в общий стор.
  useEffect(() => {
    if (!isHost) return;
    snapshot = {
      isListening: session.isListening,
      phase: processing ? 'processing' : (session.isListening ? 'recording' : 'idle'),
      liveText: session.liveText,
      interimText: session.interimText,
      level: meter.level,
      levels: waveLevels,
      levelFailed: meter.failed || yielded || (session.isListening && !meterAllowed),
      seconds,
      aiNoticeRemaining: aiNotice.yes ? aiNotice.remaining : null,
      hasSupport: session.hasSupport,
      isVaultActive: session.isVaultActive,
    };
    notify();
  }, [
    isHost, session.isListening, session.liveText, session.interimText, session.hasSupport,
    session.isVaultActive, meter.level, meter.failed, processing, seconds, aiNotice, yielded, meterAllowed,
  ]);

  const begin = useCallback((noticeHandled: boolean) => {
    if (processing) return;
    if (session.isListening) {
      session.stopListening();
      return;
    }
    // documentId снимается на старте, а не на стопе: смена заметки посреди записи
    // должна быть заметна и отменяема.
    const snap = useSessionMetaStore.getState();
    const docId = snap.savedDocumentId;
    docIdRef.current = docId;
    targetRef.current = { docId, nonce: snap.draftNonce };
    setAiNotice(aiDeps.willPunctuate());
    void aiDeps.noteHidden(docId ?? undefined).then(hidden => {
      if (hidden) setAiNotice({ yes: false, remaining: 0 });
    });
    void session.toggleListening({ noticeHandled });
  }, [processing, session]);
  const toggle = useCallback(() => begin(false), [begin]);
  const startAfterNotice = useCallback(() => begin(true), [begin]);

  const stop = useCallback(() => {
    session.stopListening();
  }, [session]);

  const cancel = useCallback(() => {
    deliverySeqRef.current += 1;
    session.cancel();
    setProcessing(false);
    setSeconds(0);
  }, [session]);

  // Команды хоста доступны остальным экземплярам hook'а.
  useEffect(() => {
    if (!isHost) return;
    hostCommands = { toggle, startAfterNotice, stop, cancel };
  }, [isHost, toggle, startAfterNotice, stop, cancel]);

  useEffect(() => {
    if (!isHost || !session.isListening) return;
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [isHost, session.isListening]);

  // Esc во время записи = отменить, фокус остаётся в редакторе.
  useEffect(() => {
    if (!isHost || !session.isListening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isHost, session.isListening, cancel]);

  // Смена или уход заметки во время записи — отмена: вставку нельзя класть в
  // чужой документ.
  useEffect(() => {
    if (!isHost || !session.isListening) return;
    const id = setInterval(() => {
      if (sameDictationTarget(targetRef.current, useSessionMetaStore.getState())) return;
      const said = liveTextRef.current;
      cancel();
      if (said) offerCopy(said, 'voice_cancelled_note_changed');
    }, 500);
    return () => clearInterval(id);
  }, [isHost, session.isListening, cancel, offerCopy]);

  const remote = useSyncExternalStore(subscribeToStore, readSnapshot, readSnapshot);
  if (!isHost) {
    return {
      ...remote,
      toggle: () => { hostCommands?.toggle(); },
      startAfterNotice: () => { hostCommands?.startAfterNotice(); },
      stop: () => { hostCommands?.stop(); },
      cancel: () => { hostCommands?.cancel(); },
    };
  }

  return {
    isListening: session.isListening,
    phase: processing ? 'processing' : (session.isListening ? 'recording' : 'idle'),
    liveText: session.liveText,
    interimText: session.interimText,
    level: meter.level,
    levels: waveLevels,
    levelFailed: meter.failed || yielded || (session.isListening && !meterAllowed),
    seconds,
    aiNoticeRemaining: aiNotice.yes ? aiNotice.remaining : null,
    hasSupport: session.hasSupport,
    isVaultActive: session.isVaultActive,
    toggle,
    startAfterNotice,
    stop,
    cancel,
  };
}

/** MF-5: сколько запросов останется, если запись пойдёт через ИИ (null — не пойдёт).
 *  Только локальные чтения (квота, скрытость заметки): ИИ до «Записать» не зовётся. */
export async function previewDictationCost(): Promise<number | null> {
  const w = aiDeps.willPunctuate();
  if (!w.yes) return null;
  const docId = useSessionMetaStore.getState().savedDocumentId;
  const hidden = await aiDeps.noteHidden(docId ?? undefined).catch(() => false);
  return hidden ? null : w.remaining;
}

/** iPhone/iPad, в том числе iPad в режиме «как компьютер» (платформа MacIntel с касанием). */
function isIosWebKit(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('DICTATION_PUNCTUATE_TIMEOUT')), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
/** Принадлежит ли текущая редакторская сессия той же заметке, что и старт записи. */
export function sameDictationTarget(
  captured: { docId: string | null; nonce: string },
  now: { savedDocumentId: string | null; draftNonce: string },
): boolean {
  if (now.draftNonce !== captured.nonce) return false;
  if (now.savedDocumentId === captured.docId) return true;
  // Тот же черновик был сохранён во время пунктуации: id появился — заметка та же.
  return captured.docId === null;
}
