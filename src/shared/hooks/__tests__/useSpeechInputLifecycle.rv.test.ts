// Ревью партии D (09.10.2026): жизненный цикл экземпляра распознавания.
//
// В браузере onend приходит и после abort(), и после сбоя, и у экземпляра,
// который уже заменён новым. Прежде каждый такой onend шёл в ветку
// «браузер оборвал сессию — перезапустить», поэтому:
// · уход с экрана письма во время записи оставлял микрофон включённым (Z1);
// · после сбоя с доставкой движок оживал, а его текст уже никто не принимал (Z2);
// · старый экземпляр после перезапуска ради метра оживал рядом с новым (Z3);
// · пустой финал сдвигал счёт, и фраза после перезапуска затирала прежнюю (Z4).
//
// Мутации: isCurrent → всегда true — Z3, Z5 красные; убрать deliveredRef в onend
// — Z2; вернуть filter(Boolean).length — Z4. Z1 защищён дважды (isCurrent и
// cancelledRef в cleanup) и краснеет при возврате прежнего cleanup.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechInput } from '../useSpeechInput';
import { LanguageProvider } from '../../i18n';

vi.mock('../../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

interface Rec { onstart: (() => void) | null; onresult: ((e: unknown) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn>; continuous: boolean; interimResults: boolean; lang: string }
const instances: Rec[] = [];
class Mock implements Rec {
  continuous = false; interimResults = false; lang = '';
  onstart: Rec['onstart'] = null; onresult: Rec['onresult'] = null; onerror: Rec['onerror'] = null; onend: Rec['onend'] = null;
  start = vi.fn(); stop = vi.fn();
  // как в браузере: abort() → onend позже
  abort = vi.fn(() => { setTimeout(() => this.onend?.(), 0); });
  constructor() { instances.push(this); }
}
function ev(i: number, t: string) { const r = [{ 0: { transcript: t }, isFinal: true }]; return { resultIndex: i, results: Object.assign(r, { length: 1 }) }; }

beforeEach(() => { instances.length = 0; vi.useFakeTimers(); (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = Mock; });
afterEach(() => { vi.useRealTimers(); delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition; });

describe('распознавание: жизненный цикл экземпляра', () => {
  it('Z1: уход со страницы во время записи не перезапускает распознавание', () => {
    const { result, unmount } = renderHook(() => useSpeechInput({ onSessionEnd: vi.fn() }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); rec.onresult?.(ev(0, 'привет')); });
    expect(rec.start).toHaveBeenCalledTimes(1);
    unmount();
    vi.advanceTimersByTime(10);
    expect(rec.start).toHaveBeenCalledTimes(1);
  });

  it('Z2: после ошибки network (с доставкой) onend не перезапускает движок', () => {
    const onSessionEnd = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); rec.onresult?.(ev(0, 'раз')); });
    act(() => { rec.onerror?.({ error: 'network' }); rec.onend?.(); });
    expect(onSessionEnd).toHaveBeenCalledWith('раз');
    expect(rec.start).toHaveBeenCalledTimes(1);
  });

  it('Z3: старый экземпляр после перезапуска (уступка метру) не оживает', () => {
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd: vi.fn() }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    const old = instances[0]!;
    act(() => { old.onstart?.(); });
    act(() => { result.current.startListening(); });
    vi.advanceTimersByTime(10);
    expect(old.start).toHaveBeenCalledTimes(1);
  });

  it('Z4: пустой финал до перезапуска не затирает фразу', () => {
    const onSessionEnd = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => {
      rec.onstart?.();
      const r = [{ 0: { transcript: 'один' }, isFinal: true }, { 0: { transcript: '' }, isFinal: true }, { 0: { transcript: 'три' }, isFinal: true }];
      rec.onresult?.({ resultIndex: 0, results: Object.assign(r, { length: 3 }) });
    });
    act(() => { rec.onend?.(); }); // браузер оборвал сам → перезапуск
    act(() => { rec.onresult?.(ev(0, 'четыре')); });
    act(() => { result.current.stopListening(); rec.onend?.(); });
    expect(onSessionEnd).toHaveBeenCalledWith('один три четыре');
  });

  it('Z5: перезапуск из onError (уступка метру) не снимает доставку новой сессии', () => {
    const onSessionEnd = vi.fn();
    let restart: () => void = () => undefined;
    const onError = vi.fn((error: string) => { if (error === 'audio-capture') restart(); });
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd, onError }), { wrapper: LanguageProvider });
    restart = () => result.current.startListening();
    act(() => { result.current.startListening(); });
    const first = instances[0]!;
    act(() => { first.onstart?.(); first.onerror?.({ error: 'audio-capture' }); });
    const second = instances[1]!;
    act(() => { second.onstart?.(); second.onresult?.(ev(0, 'после уступки')); });
    act(() => { result.current.stopListening(); second.onend?.(); });
    expect(onSessionEnd).toHaveBeenCalledWith('после уступки');
  });
});
