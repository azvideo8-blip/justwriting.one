// Диктовка в Яндекс-браузере на Mac (0.9.34, 09.10.2026): «что-то вставилось, но
// не всё», а через минуту записи — «network».
// · Яндекс в continuous-режиме отдаёт каждую новую фразу снова под индексом 0;
//   запись финалов по индексу оставляла только последнюю фразу (Y1).
// · Android Chrome шлёт тот же слот повторно и наращивая его — это одна фраза (Y2).
// · «network» и «no-speech» не заканчивают запись: сессия перезапускается, текст
//   копится дальше (Y3); пустые перезапуски подряд её всё же заканчивают (Y4).
//
// Мутации: запись финала строго по индексу → Y1 красный; «network» снова
// фатальный → Y3 красный; без счётчика пустых перезапусков → Y4 красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechInput } from '../useSpeechInput';
import { LanguageProvider } from '../../i18n';

const { showToastMock } = vi.hoisted(() => ({ showToastMock: vi.fn() }));
vi.mock('../../components/Toast', () => ({ useToast: () => ({ showToast: showToastMock }) }));

interface Rec { onstart: (() => void) | null; onresult: ((e: unknown) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn>; continuous: boolean; interimResults: boolean; lang: string }
const instances: Rec[] = [];
class Mock implements Rec {
  continuous = false; interimResults = false; lang = '';
  onstart: Rec['onstart'] = null; onresult: Rec['onresult'] = null; onerror: Rec['onerror'] = null; onend: Rec['onend'] = null;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
  constructor() { instances.push(this); }
}
function ev(i: number, t: string, isFinal = true) {
  const r = [{ 0: { transcript: t }, isFinal }];
  return { resultIndex: i, results: Object.assign(r, { length: 1 }) };
}
function mount() {
  const onSessionEnd = vi.fn();
  const { result } = renderHook(() => useSpeechInput({ onSessionEnd }), { wrapper: LanguageProvider });
  act(() => { result.current.startListening(); });
  const rec = instances[0]!;
  act(() => { rec.onstart?.(); });
  return { result, rec, onSessionEnd };
}

beforeEach(() => {
  instances.length = 0;
  showToastMock.mockClear();
  vi.useFakeTimers();
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = Mock;
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe('диктовка: Яндекс-браузер и обрывы', () => {
  it('Y1: каждая фраза под индексом 0 — все фразы доходят по порядку', () => {
    const { result, rec, onSessionEnd } = mount();
    act(() => { rec.onresult?.(ev(0, 'первая фраза', false)); });
    act(() => { rec.onresult?.(ev(0, 'первая фраза')); });
    act(() => { rec.onresult?.(ev(0, 'вторая', false)); });
    act(() => { rec.onresult?.(ev(0, 'вторая фраза')); });
    act(() => { rec.onresult?.(ev(0, 'третья фраза')); });
    expect(result.current.liveText).toBe('первая фраза вторая фраза третья фраза');
    act(() => { result.current.stopListening(); rec.onend?.(); });
    expect(onSessionEnd).toHaveBeenCalledWith('первая фраза вторая фраза третья фраза');
  });

  it('Y2: повтор и наращивание того же слота — одна фраза, без удвоения', () => {
    const { result, rec, onSessionEnd } = mount();
    act(() => { rec.onresult?.(ev(0, 'привет')); });
    act(() => { rec.onresult?.(ev(0, 'привет')); });
    act(() => { rec.onresult?.(ev(0, 'привет мир')); });
    act(() => { result.current.stopListening(); rec.onend?.(); });
    expect(onSessionEnd).toHaveBeenCalledWith('привет мир');
  });

  it('Y3: «network» посреди записи — без тоста, сессия перезапускается, текст копится', () => {
    const { result, rec, onSessionEnd } = mount();
    act(() => { rec.onresult?.(ev(0, 'до обрыва')); });
    act(() => { rec.onerror?.({ error: 'network' }); });
    expect(result.current.isListening).toBe(true);
    act(() => { rec.onend?.(); });
    expect(rec.start).toHaveBeenCalledTimes(2);
    expect(onSessionEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    act(() => { rec.onresult?.(ev(0, 'после обрыва')); });
    act(() => { result.current.stopListening(); rec.onend?.(); });
    expect(showToastMock).not.toHaveBeenCalled();
    expect(onSessionEnd).toHaveBeenCalledWith('до обрыва после обрыва');
  });

  it('Y4: пустые перезапуски подряд заканчивают запись и отдают собранное', () => {
    const { rec, onSessionEnd } = mount();
    act(() => { rec.onresult?.(ev(0, 'успели сказать')); });
    for (let k = 0; k < 6; k++) {
      vi.advanceTimersByTime(5000);
      act(() => { rec.onerror?.({ error: 'no-speech' }); rec.onend?.(); });
    }
    expect(onSessionEnd).toHaveBeenCalledWith('успели сказать');
    expect(rec.start.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
