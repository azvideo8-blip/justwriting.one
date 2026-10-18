// N-1 (решение владельца 2026-10-18): диктовка без интернета говорит правду и не
// теряет слова. Раньше сбой `network` считался восстановимым (`useSpeechInput.ts:57-61`),
// сессия перезапускалась, человек видел «запись идёт», а текста не было.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechInput } from '../useSpeechInput';
import { LanguageProvider } from '../../i18n';

const showToast = vi.hoisted(() => vi.fn());
vi.mock('../../components/Toast', () => ({ useToast: () => ({ showToast }) }));

interface Rec {
  onstart: (() => void) | null;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  continuous: boolean; interimResults: boolean; lang: string;
}
const instances: Rec[] = [];
class Mock implements Rec {
  continuous = false; interimResults = false; lang = '';
  onstart: Rec['onstart'] = null; onresult: Rec['onresult'] = null; onerror: Rec['onerror'] = null; onend: Rec['onend'] = null;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn(() => { setTimeout(() => this.onend?.(), 0); });
  constructor() { instances.push(this); }
}
function ev(i: number, t: string) {
  const r = [{ 0: { transcript: t }, isFinal: true }];
  return { resultIndex: i, results: Object.assign(r, { length: 1 }) };
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

describe('N-1: диктовка офлайн', () => {
  beforeEach(() => {
    instances.length = 0;
    showToast.mockClear();
    vi.useFakeTimers();
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = Mock;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    setOnline(true);
  });

  it('без сети сбой `network` отдаёт собранное и не перезапускает движок', () => {
    setOnline(false);
    const onSessionEnd = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); rec.onresult?.(ev(0, 'глина сохнет')); });
    act(() => { rec.onerror?.({ error: 'network' }); rec.onend?.(); });
    vi.advanceTimersByTime(10);

    // Ни одно слово не потеряно: текст ушёл потребителю.
    expect(onSessionEnd, 'распознанное до обрыва не отдано').toHaveBeenCalledWith('глина сохнет');
    // И не делает вид, что запись идёт: движок не перезапущен, флаг снят.
    expect(rec.start).toHaveBeenCalledTimes(1);
    expect(result.current.isListening).toBe(false);
  });

  it('без сети человек слышит, что распознавание недоступно, а не «voice_error: network»', () => {
    setOnline(false);
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd: vi.fn() }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); rec.onerror?.({ error: 'network' }); });
    const said = showToast.mock.calls.map(c => String(c[0])).join(' | ');
    // Словарь настоящий (`LanguageProvider`), поэтому проверяется фраза, а не ключ.
    expect(said, 'нет честной причины').toContain('распознавание речи недоступно');
    expect(said, 'вместо причины — сырой код ошибки').not.toContain(': network');
    expect(showToast.mock.calls.some(c => c[1] === 'warning' || c[1] === 'info')).toBe(true);
  });

  it('с сетью `network` остаётся восстановимым сбоем: сессия перезапускается (регрессия)', () => {
    setOnline(true);
    const onSessionEnd = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); rec.onresult?.(ev(0, 'раз')); });
    act(() => { rec.onerror?.({ error: 'network' }); rec.onend?.(); });
    vi.advanceTimersByTime(10);
    expect(rec.start).toHaveBeenCalledTimes(2);
    expect(onSessionEnd).not.toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);
  });
});
