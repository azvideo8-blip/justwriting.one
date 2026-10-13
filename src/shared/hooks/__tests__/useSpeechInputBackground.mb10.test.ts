// MB-10 (findings-G G3): уход приложения в фон во время диктовки не должен
// включать микрофон заново. Было: фон даёт `error: aborted`, затем `end`;
// `onend` не видел ни wantStop, ни cancelled и звал recognition.start() — после
// возврата панель показывала «Остановить диктовку», а микрофон писал без действия
// человека (engine.starts: 2).
//
// Мутации: вернуть `aborted` в число продолжаемых (не ставить abortedRef) —
// проверка 1 красная; убрать слушателя visibilitychange — красная проверка 2;
// убрать условие «только палец» — красная проверка 4 (на компьютере соседняя
// вкладка или закрытое окно диктовку не рвут).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechInput } from '../useSpeechInput';
import { LanguageProvider } from '../../i18n';

vi.mock('../../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

interface Rec {
  onstart: (() => void) | null; onresult: ((e: unknown) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn>;
  continuous: boolean; interimResults: boolean; lang: string;
}
const instances: Rec[] = [];
class Mock implements Rec {
  continuous = false; interimResults = false; lang = '';
  onstart: Rec['onstart'] = null; onresult: Rec['onresult'] = null; onerror: Rec['onerror'] = null; onend: Rec['onend'] = null;
  start = vi.fn(); stop = vi.fn();
  abort = vi.fn(() => { setTimeout(() => this.onend?.(), 0); });
  constructor() { instances.push(this); }
}
function ev(i: number, t: string) {
  const r = [{ 0: { transcript: t }, isFinal: true }];
  return { resultIndex: i, results: Object.assign(r, { length: 1 }) };
}
// Две фразы одним событием: у results длина = число фраз, иначе цикл по
// resultIndex до length ничего не прочитает.
function evAll(...texts: string[]) {
  const r = texts.map(t => ({ 0: { transcript: t }, isFinal: true }));
  return { resultIndex: 0, results: Object.assign(r, { length: texts.length }) };
}

function setPointer(coarse: boolean): void {
  window.matchMedia = ((q: string) => ({ matches: coarse && q === '(pointer: coarse)', media: q })) as unknown as typeof window.matchMedia;
}

function hide(): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

beforeEach(() => {
  instances.length = 0;
  vi.useFakeTimers();
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = Mock;
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('MB-10: фон и aborted не включают микрофон заново', () => {
  it('после aborted + end сессия отдаётся и не перезапускается', () => {
    const onSessionEnd = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); rec.onresult?.(ev(0, 'сказанное до фона')); });

    // Как это делает браузер при сворачивании: сначала aborted, потом end.
    act(() => { rec.onerror?.({ error: 'aborted' }); });
    act(() => { rec.onend?.(); });
    vi.advanceTimersByTime(10);

    expect(rec.start, 'движок перезапустился сам').toHaveBeenCalledTimes(1);
    expect(onSessionEnd).toHaveBeenCalledWith('сказанное до фона');
    expect(result.current.isListening, 'панель всё ещё «Остановить диктовку»').toBe(false);
  });

  it('visibilitychange → hidden во время записи завершает сессию как «Стоп»', () => {
    setPointer(true);
    const onSessionEnd = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); rec.onresult?.(evAll('фраза', 'вторая')); });

    hide();
    expect(rec.stop, 'уход в фон не остановил распознавание').toHaveBeenCalledTimes(1);

    // Движок отвечает end — и собранное уходит потребителю, без перезапуска.
    act(() => { rec.onend?.(); });
    vi.advanceTimersByTime(10);
    expect(onSessionEnd).toHaveBeenCalledWith('фраза вторая');
    expect(rec.start).toHaveBeenCalledTimes(1);
  });

  it('продолжаемые сбои (network, no-speech) перезапускаются по-прежнему', () => {
    const onSessionEnd = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); rec.onresult?.(ev(0, 'до обрыва')); });

    act(() => { rec.onerror?.({ error: 'no-speech' }); rec.onend?.(); });
    vi.advanceTimersByTime(10);
    expect(rec.start.mock.calls.length, 'после no-speech браузер обязан продолжить сам').toBeGreaterThanOrEqual(2);
    expect(onSessionEnd).not.toHaveBeenCalled();
  });

  it('на компьютере (не только палец) уход вкладки в фон диктовку не останавливает', () => {
    setPointer(false);
    const onSessionEnd = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); rec.onresult?.(ev(0, 'диктую дальше')); });

    hide();
    expect(rec.stop, 'на компьютере фон остановил диктовку').not.toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);
    expect(onSessionEnd).not.toHaveBeenCalled();
  });
});
