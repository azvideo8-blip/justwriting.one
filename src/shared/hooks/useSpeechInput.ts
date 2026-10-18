import { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '../i18n';
import { useToast } from '../components/Toast';
import { hasOnlyTouchPointer } from '../utils/touchPointer';

interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: {
    transcript: string;
  };
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: () => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface UseSpeechInputProps {
  /** Сырой код ошибки распознавания. Нужен D-4: если микрофон отдал себя метру
   *  уровня (audio-capture / not-allowed), диктовка должна уступить и
   *  перезапуститься без волны. */
  onError?: ((error: string) => void) | undefined;
  /** Вызывается ОДИН раз на сессию: после stop'а, нажатого человеком, или после
   *  сбоя, когда часть текста уже распознана. Пустой текст не доставляется. */
  onSessionEnd: (fullText: string) => void;
}

// Chrome обрывает continuous-сессию сам после длинной паузы. Мы перезапускаем её
// на том же экземпляре, но два перезапуска подряд без нового результата — это
// захлебнувшийся движок, а не тишина человека: дальше крутить бессмысленно.
const RESTART_GUARD_MS = 1000;
// Подряд идущие перезапуски без единого результата (человек замолчал, сеть
// пропала). Дальше крутить микрофон вхолостую нельзя: отдаём собранное.
const MAX_EMPTY_RESTARTS = 3;
// Сбои, после которых сессию надо продолжить, а не закончить: «network» Chrome и
// Яндекс-браузер отдают примерно через минуту непрерывной записи, «no-speech» —
// на паузе. До 0.9.34 фразы вставлялись по одной, и такой обрыв терял одну
// фразу; теперь текст копится до Stop, и обрыв не должен заканчивать запись.
const RECOVERABLE_ERRORS = new Set(['network', 'no-speech']);

const fold = (s: string) => s.trim().toLowerCase();
/** Тот же финал повторно или его наращивание (Android Chrome шлёт «привет»,
 *  потом «привет мир» в тот же слот) — это не новая фраза. */
function sameOrGrowing(prev: string, next: string): boolean {
  const a = fold(prev), b = fold(next);
  return a === b || b.startsWith(a) || a.startsWith(b);
}

export function useSpeechInput({ onSessionEnd, onError }: UseSpeechInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [liveText, setLiveText] = useState('');
  // Хвост-черновик отдельным полем: панель записи (D-4) показывает его светлее
  // финальных фраз, человеку видно, что ещё не закрепилось.
  const [interimText, setInterimText] = useState('');

  // Use lazy state initialization to check support and avoid synchronous setState in useEffect
  const [hasSupport] = useState(() => {
    if (typeof window === 'undefined') return false;
    const win = window as unknown as {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };
    return !!(win.SpeechRecognition || win.webkitSpeechRecognition);
  });

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // Финальные фразы по индексу результата: одно и то же событие, пришедшее
  // повторно (так делает Android Chrome), перезаписывает слот, а не добавляет
  // слово дважды.
  const finalsRef = useRef<string[]>([]);
  const interimRef = useRef('');
  // После перезапуска счётчик результатов начинается с нуля, а собранный текст
  // остаётся: новые индексы сдвигаются на уже записанное.
  const indexOffsetRef = useRef(0);
  const wantStopRef = useRef(false);
  // MB-10: `aborted` — это не «браузер оборвал, надо продолжить», а «сессию
  // закрыли». Без этого флага onend после aborted перезапускал движок, и после
  // возврата из фона микрофон писал снова сам (findings-G G3: starts: 2).
  const abortedRef = useRef(false);
  // N-1 (решение владельца 2026-10-18): без сети `network` — не пауза, а смерть
  // движка. Флаг нужен, чтобы `onend` после сбоя не пошёл в ветку перезапуска:
  // человек не должен видеть «запись идёт», когда распознавать нечему.
  const offlineStopRef = useRef(false);
  const cancelledRef = useRef(false);
  const deliveredRef = useRef(false);
  const resultsSinceRestartRef = useRef(0);
  const lastRestartAtRef = useRef<number | null>(null);
  const emptyRestartsRef = useRef(0);
  const { language, t } = useLanguage();
  const { showToast } = useToast();

  const joinSession = useCallback((): string => {
    const finals = finalsRef.current.filter(Boolean);
    const tail = interimRef.current.trim();
    return [...finals, tail].filter(Boolean).join(' ').trim();
  }, []);

  const publishLive = useCallback(() => {
    setLiveText(joinSession());
    setInterimText(interimRef.current);
  }, [joinSession]);

  const deliver = useCallback(() => {
    if (deliveredRef.current) return;
    deliveredRef.current = true;
    const full = joinSession();
    finalsRef.current = [];
    interimRef.current = '';
    indexOffsetRef.current = 0;
    setLiveText('');
    setInterimText('');
    setIsListening(false);
    // Пустая сессия (человек молчал, движок умер) не должна рождать ни
    // вставку, ни запрос пунктуации.
    if (full) onSessionEnd(full);
    // Человек нажал «■», а слов нет: сказать, что не расслышали, а не молчать —
    // иначе это выглядит как сломанная кнопка (видео владельца 2026-10-17).
    else if (wantStopRef.current) showToast(t('voice_nothing_heard'), 'info');
  }, [joinSession, onSessionEnd, showToast, t]);

  const stopListening = useCallback(() => {
    wantStopRef.current = true;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    deliveredRef.current = true;
    finalsRef.current = [];
    interimRef.current = '';
    indexOffsetRef.current = 0;
    setLiveText('');
    setInterimText('');
    setIsListening(false);
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }
  }, []);

  const startListening = useCallback(() => {
    if (!hasSupport || typeof window === 'undefined') return;

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    finalsRef.current = [];
    interimRef.current = '';
    indexOffsetRef.current = 0;
    wantStopRef.current = false;
    offlineStopRef.current = false;
    abortedRef.current = false;
    cancelledRef.current = false;
    deliveredRef.current = false;
    resultsSinceRestartRef.current = 0;
    lastRestartAtRef.current = null;
    emptyRestartsRef.current = 0;
    setLiveText('');

    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language === 'ru' ? 'ru-RU' : 'en-US';

    // Ревью 09.10: события прежнего экземпляра (после ухода со страницы, после
    // перезапуска ради метра) приходят позже, уже на общие ref'ы. Без этой
    // проверки onend старого экземпляра перезапускал его, и микрофон оставался
    // включённым после ухода с экрана письма.
    const isCurrent = () => recognitionRef.current === recognition;

    recognition.onstart = () => {
      if (!isCurrent()) return;
      setIsListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (!isCurrent()) return;
      resultsSinceRestartRef.current += 1;
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const res = event.results[i];
        if (!res) continue;
        const transcript = res[0]?.transcript ?? '';
        if (res.isFinal) {
          let slot = indexOffsetRef.current + i;
          const prev = finalsRef.current[slot];
          // Яндекс-браузер в continuous-режиме отдаёт каждую новую фразу снова
          // под индексом 0: запись по индексу оставляла только последнюю фразу
          // («что-то вставилось, но не всё», 0.9.34). Другая фраза в занятом
          // слоте — новая фраза: она встаёт в конец, и счёт сдвигается за неё.
          if (prev && !sameOrGrowing(prev, transcript)) {
            slot = finalsRef.current.length;
            indexOffsetRef.current = slot - i;
          }
          finalsRef.current[slot] = transcript;
          // Финальная фраза пришла на то же место, где висел черновик, — хвост
          // больше не нужен, иначе liveText покажет слово дважды.
          interimRef.current = '';
        } else {
          interimRef.current = transcript;
        }
      }
      publishLive();
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (!isCurrent()) return;
      console.error('[useSpeechInput] Speech recognition error', event.error);
      onError?.(event.error);
      // Потребитель мог перезапустить распознавание прямо из onError (уступка
      // метру, D-4): дальше этот экземпляр уже чужой, и доставка отсюда сняла бы
      // флаг новой сессии.
      if (!isCurrent()) return;
      if (event.error !== 'aborted') {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (RECOVERABLE_ERRORS.has(event.error) && !wantStopRef.current && offline && event.error === 'network') {
          // Офлайн-сбой не продолжение: отдаём сказанное и останавливаем сессию.
          offlineStopRef.current = true;
          showToast(t('voice_offline_no_recognition'), 'warning');
          deliver();
        } else if (RECOVERABLE_ERRORS.has(event.error) && !wantStopRef.current) {
          // Сессию продолжит onend (ветка перезапуска); если перезапуски пойдут
          // вхолостую, там же собранное и отдадут.
        } else {
          let msg = t('voice_error') + ': ' + event.error;
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            msg = language === 'ru'
              ? 'Микрофон заблокирован браузером или политикой организации'
              : 'Microphone is blocked by the browser or organization policy';
          }
          showToast(msg, 'error');
          // Распознанное до сбоя не теряется: доставка идёт здесь, потому что
          // за onerror обычно следует onend, а туда-обратно уже не дойдёт.
          deliver();
        }
      } else {
        // `aborted`: конец сессии, а не пауза. Досказывать будет onend — там
        // flag отдаёт собранное и НЕ перезапускает.
        abortedRef.current = true;
        setIsListening(false);
      }
      // Для продолжаемых сбоев isListening не сбрасываем: иначе панель записи
      // мигала бы на каждом перезапуске, а метр заново просил бы микрофон.
    };

    recognition.onend = () => {
      if (!isCurrent()) return;
      // Отмена или уже доставленная сессия (сбой в onerror): перезапуск здесь
      // оживил бы движок, текст которого никто больше не примет.
      if (cancelledRef.current || deliveredRef.current) {
        setIsListening(false);
        return;
      }
      if (wantStopRef.current || abortedRef.current || offlineStopRef.current) {
        deliver();
        return;
      }
      // Сессию оборвал браузер. Если новых результатов не было уже дважды подряд
      // — движок захлебнулся, и перезапускать его нельзя: отдаём то, что есть.
      const now = Date.now();
      const lastRestart = lastRestartAtRef.current;
      if (lastRestart !== null && resultsSinceRestartRef.current === 0 && now - lastRestart < RESTART_GUARD_MS) {
        showToast(t('voice_error') + ': no-restart', 'error');
        deliver();
        return;
      }
      emptyRestartsRef.current = resultsSinceRestartRef.current === 0 ? emptyRestartsRef.current + 1 : 0;
      if (emptyRestartsRef.current > MAX_EMPTY_RESTARTS) {
        deliver();
        return;
      }
      lastRestartAtRef.current = now;
      resultsSinceRestartRef.current = 0;
      // Длина массива, а не число непустых фраз: пустой финал (бывает на Android)
      // оставляет слот, и счёт по непустым ставил новую фразу поверх последней.
      indexOffsetRef.current = finalsRef.current.length;
      interimRef.current = '';
      try {
        recognition.start();
      } catch {
        // Движок не принимает повторный start: отдаём собранное, а не молчим.
        deliver();
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [hasSupport, language, publishLive, deliver, onError, showToast, t]);

  // MB-10: уход в фон во время записи — то же самое, что нажатие «Стоп»:
  // собранное отдаётся и дописывается, микрофон остаётся выключенным.
  // Только на сенсорных устройствах: на компьютере «фон» — это и соседняя
  // вкладка, и окно, закрытое другим окном; диктовку там прежде не рвало.
  useEffect(() => {
    if (!isListening || !hasOnlyTouchPointer()) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stopListening();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [isListening, stopListening]);

  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      cancelledRef.current = true;
      recognitionRef.current = null;
      recognition?.abort();
    };
  }, []);

  return {
    isListening,
    liveText,
    interimText,
    startListening,
    stopListening,
    cancel,
    hasSupport,
  };
}
