// Владелец 06.11, iPhone: запись дольше минуты, «стоп» не делает ничего, сколько ни нажимай.
// Доставку вёл только onend, а движок, переставший отвечать, его не присылает.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechInput } from '../useSpeechInput';
import { LanguageProvider } from '../../i18n';

const { showToastMock, reportErrorMock } = vi.hoisted(() => ({ showToastMock: vi.fn(), reportErrorMock: vi.fn() }));
vi.mock('../../components/Toast', () => ({ useToast: () => ({ showToast: showToastMock }) }));
vi.mock('../../errors/reportError', () => ({ reportError: reportErrorMock }));

class FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: (() => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() { instances.push(this); }
}
const instances: FakeRecognition[] = [];

const finalResult = (transcript: string) => ({
  resultIndex: 0,
  results: Object.assign([{ 0: { transcript }, isFinal: true }], { length: 1 }),
});

function begin(said = 'первая минута') {
  const onSessionEnd = vi.fn();
  const view = renderHook(() => useSpeechInput({ onSessionEnd }), { wrapper: LanguageProvider });
  act(() => { view.result.current.startListening(); });
  const engine = instances[0]!;
  act(() => { engine.onstart?.(); engine.onresult?.(finalResult(said)); });
  return { ...view, onSessionEnd, engine };
}

beforeEach(() => {
  vi.useFakeTimers();
  instances.length = 0;
  showToastMock.mockClear();
  reportErrorMock.mockClear();
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe('«стоп», когда движок не отвечает', () => {
  it('движок молчит после stop(): текст доставлен, запись закрыта', () => {
    const { result, onSessionEnd, engine } = begin();
    act(() => { result.current.stopListening(); });
    expect(onSessionEnd).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    expect(onSessionEnd).toHaveBeenCalledWith('первая минута');
    expect(result.current.isListening).toBe(false);
    expect(engine.abort).toHaveBeenCalled();
    expect(JSON.stringify(reportErrorMock.mock.calls)).not.toContain('первая минута');
  });

  it('stop() бросает: кнопка всё равно завершает запись', () => {
    const { result, onSessionEnd, engine } = begin();
    engine.stop.mockImplementation(() => { throw new Error('InvalidStateError'); });
    act(() => { result.current.stopListening(); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
  });

  it('опоздавшие события движка не дописывают и не доставляют второй раз', () => {
    const { result, onSessionEnd, engine } = begin();
    act(() => { result.current.stopListening(); });
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { engine.onresult?.(finalResult('опоздало')); engine.onend?.(); });
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    expect(result.current.liveText).toBe('');
  });

  it('обычный движок: доставка по onend, страховка молчит', () => {
    const { result, onSessionEnd, engine } = begin();
    act(() => { result.current.stopListening(); result.current.stopListening(); });
    act(() => { engine.onend?.(); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    expect(engine.abort).not.toHaveBeenCalled();
    expect(reportErrorMock).not.toHaveBeenCalled();
  });
});

describe('перезапуск, который браузер не выполнил', () => {
  it('start() без события start: сказанное отдаётся, человек узнаёт о конце записи', () => {
    const { result, onSessionEnd, engine } = begin();
    act(() => { engine.onend?.(); });
    expect(engine.start).toHaveBeenCalledTimes(2);
    expect(onSessionEnd).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(onSessionEnd).toHaveBeenCalledWith('первая минута');
    expect(result.current.isListening).toBe(false);
    expect(showToastMock).toHaveBeenCalledTimes(1);
  });

  it('перезапуск состоялся: запись идёт дальше', () => {
    const { result, onSessionEnd, engine } = begin();
    act(() => { engine.onend?.(); engine.onstart?.(); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(onSessionEnd).not.toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);
    expect(showToastMock).not.toHaveBeenCalled();
  });
});
