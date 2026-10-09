import { useEffect, useRef, useState } from 'react';

// D-2: живой уровень микрофона для панели записи.
//
// Волна — не украшение: без неё человек не понимает, слышит ли его браузер, и
// продолжает говорить в тишину. Показывать её нельзя ценой диктовки: на iOS
// Safari и некоторых Android-сборках второй потребитель микрофона отнимает его у
// SpeechRecognition, поэтому сбой здесь — это `failed: true` и точка вместо
// волны (D-4), а не ошибка и не прерванная запись.
//
// Состояние пишется только из колбэков браузера (promise и кадр анимации):
// синхронный setState в теле эффекта дал бы каскадный рендер на каждое
// переключение записи.

const LEVEL_INTERVAL_MS = 50; // ~20 обновлений в секунду — больше не читает глаз
const RMS_SCALE = 4; // речь даёт RMS 0,03–0,2; без усиления волна плоская
const SMOOTHING = 0.6; // инерция прежнего уровня: новые выбросы гасятся старыми

export interface MicLevel {
  level: number;
  failed: boolean;
}

type AudioContextCtor = new () => AudioContext;
// Тип Window в этом tsconfig AudioContext не описывает, а webkit-имя точно
// отсутствует в либах — обращаемся через собственное расширение.
type WindowWithAudio = Window & { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };

function legacyAudioContext(): AudioContextCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as WindowWithAudio;
  return w.AudioContext ?? w.webkitAudioContext;
}

function micApiAvailable(): boolean {
  return typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
    && typeof legacyAudioContext() === 'function';
}

export function useMicLevel(active: boolean): MicLevel {
  const [level, setLevel] = useState(0);
  const [failed, setFailed] = useState(false);
  // Поток может быть получен уже после выключения: ref нужен, чтобы в cleanup
  // всё равно остановить треки и не оставить индикатор записи во вкладке.
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!active || !micApiAvailable()) return;

    let disposed = false;
    let raf = 0;
    let smoothed = 0;
    let lastPublish = 0;
    const data = new Uint8Array(256);

    const markFailed = () => {
      if (disposed) return;
      setFailed(true);
      setLevel(0);
    };

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        if (disposed) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        const Ctor = legacyAudioContext();
        if (!Ctor) {
          markFailed();
          return;
        }
        let ctx: AudioContext;
        try {
          ctx = new Ctor();
        } catch {
          stream.getTracks().forEach(t => t.stop());
          streamRef.current = null;
          markFailed();
          return;
        }
        ctxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        void ctx.resume?.();
        setFailed(false);

        const frame = () => {
          analyser.getByteTimeDomainData(data);
          let sumSquares = 0;
          for (let i = 0; i < data.length; i++) {
            const sample = (data[i]! - 128) / 128;
            sumSquares += sample * sample;
          }
          const rms = Math.sqrt(sumSquares / data.length);
          smoothed = smoothed * SMOOTHING + Math.min(1, rms * RMS_SCALE) * (1 - SMOOTHING);
          const now = Date.now();
          if (now - lastPublish >= LEVEL_INTERVAL_MS) {
            lastPublish = now;
            if (!disposed) setLevel(smoothed);
          }
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      })
      .catch(() => {
        // Отказ или запрет микрофона: уровень остаётся нулевым. Это НЕ ошибка и
        // не тост — диктовка работает без волны.
        if (disposed) return;
        markFailed();
      });

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      const ctx = ctxRef.current;
      ctxRef.current = null;
      if (ctx) {
        try {
          void ctx.close();
        } catch {
          // уже закрытый контекст — не повод ронять редактор
        }
      }
    };
  }, [active]);

  return {
    level: active ? level : 0,
    failed: active ? (failed || !micApiAvailable()) : false,
  };
}
