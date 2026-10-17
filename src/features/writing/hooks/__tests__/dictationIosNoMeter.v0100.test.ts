// Видео владельца 2026-10-17 (iPhone, Яндекс Браузер — на iOS это WebKit): первая
// запись распознаётся, вторая и третья — волна идёт, а слов нет и после «■»
// ничего не вставляется. Второй потребитель микрофона (getUserMedia для волны)
// на iOS молча отнимает его у SpeechRecognition: без ошибки `audio-capture`,
// поэтому уступка D-4 не срабатывала. В первый раз волна ждала разрешения и
// проигрывала гонку, дальше — выигрывала.
// Мутация: включать волну и на iOS → красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const { guarded, meterCalls } = vi.hoisted(() => ({
  guarded: {
    isListening: true, liveText: '', interimText: '', hasSupport: true, isVaultActive: false,
    startListening: () => undefined, stopListening: () => undefined, cancel: () => undefined,
    toggleListening: async () => undefined,
  },
  meterCalls: [] as boolean[],
}));

vi.mock('../useGuardedSpeechInput', () => ({ useGuardedSpeechInput: () => guarded }));
vi.mock('../../../../shared/hooks/useMicLevel', () => ({
  useMicLevel: (active: boolean) => { meterCalls.push(active); return { level: 0, failed: false }; },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));

import { useDictation } from '../useDictation';

const realUA = navigator.userAgent;
function setUA(ua: string) { Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua }); }

describe('диктовка на iOS: волна не отнимает микрофон у распознавания', () => {
  beforeEach(() => { meterCalls.length = 0; });
  afterEach(() => setUA(realUA));

  it('iPhone: идёт запись — микрофон для волны не открывается, вместо волны точка', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) YaBrowser/25.0 Mobile/15E148 Safari/604.1');
    const { result } = renderHook(() => useDictation());
    expect(meterCalls.length).toBeGreaterThan(0);
    expect(meterCalls.every(a => a === false), 'волна просила микрофон на iOS').toBe(true);
    expect(result.current.levelFailed).toBe(true);
  });

  it('Android: волна по-прежнему включается', () => {
    setUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36');
    const { result } = renderHook(() => useDictation());
    expect(meterCalls.at(-1)).toBe(true);
    expect(result.current.levelFailed).toBe(false);
  });
});
