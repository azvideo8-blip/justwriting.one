// D-1: одна сессия диктовки. Раньше каждый финальный кусок уходил потребителю
// сразу (onTranscript на фразу), человек не видел ничего до того, как браузер
// решит, что фраза финальная, а Chrome после длинной паузы молча обрывал
// continuous-сессию. Теперь: liveText по индексам, один onSessionEnd на сессию,
// cancel без доставки, перезапуск при автономном onend с защитой от цикла.
//
// Мутации, на которых тесты краснеют: доставка из onresult → (a); убрать ветку
// перезапуска → (d).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechInput } from '../useSpeechInput';
import { LanguageProvider } from '../../i18n';
import { appendDictation } from '../../../features/writing/hooks/appendDictation';
import { useContentStore } from '../../../features/writing/store/useContentStore';

const { showToastMock } = vi.hoisted(() => ({ showToastMock: vi.fn() }));

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

interface FakeRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
}

const instances: FakeRecognition[] = [];

class MockSpeechRecognition implements FakeRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onstart = null;
  onresult = null;
  onerror = null;
  onend = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() { instances.push(this); }
}

/** Событие результата в форме браузера: results — список по индексам. */
function resultEvent(resultIndex: number, entries: Array<{ transcript: string; isFinal: boolean }>) {
  const results = entries.map(e => ({ 0: { transcript: e.transcript }, isFinal: e.isFinal }));
  return { resultIndex, results: Object.assign(results, { length: results.length }) };
}

function mount(onSessionEnd = vi.fn()) {
  const { result } = renderHook(() => useSpeechInput({ onSessionEnd }), { wrapper: LanguageProvider });
  return { result, onSessionEnd };
}

beforeEach(() => {
  instances.length = 0;
  showToastMock.mockClear();
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = MockSpeechRecognition;
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe('D-1: сессия диктовки', () => {
  it('(a) черновик виден в liveText, финал его заменяет; во время записи никто не вставляется', () => {
    const { result, onSessionEnd } = mount();
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); });

    act(() => { rec.onresult?.(resultEvent(0, [{ transcript: 'сделай пост', isFinal: false }])); });
    expect(result.current.liveText).toBe('сделай пост');

    act(() => { rec.onresult?.(resultEvent(0, [{ transcript: 'Сделай пост про осень.', isFinal: true }])); });
    expect(result.current.liveText).toBe('Сделай пост про осень.');
    expect(onSessionEnd).not.toHaveBeenCalled();
  });

  it('(b) Stop → onSessionEnd ровно один раз со всеми финальными фразами', () => {
    const { result, onSessionEnd } = mount();
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); });
    act(() => { rec.onresult?.(resultEvent(0, [{ transcript: 'Первая фраза.', isFinal: true }])); });
    // Браузер присылает results целиком, а resultIndex указывает на первый новый
    act(() => { rec.onresult?.(resultEvent(1, [{ transcript: 'Первая фраза.', isFinal: true }, { transcript: 'Вторая фраза.', isFinal: true }])); });

    act(() => { result.current.stopListening(); });
    expect(rec.stop).toHaveBeenCalledTimes(1);
    act(() => { rec.onend?.(); });

    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    expect(onSessionEnd).toHaveBeenCalledWith('Первая фраза. Вторая фраза.');
    expect(result.current.isListening).toBe(false);
  });

  it('(c) Cancel → ни доставки, ни вставки', () => {
    const { result, onSessionEnd } = mount();
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); });
    act(() => { rec.onresult?.(resultEvent(0, [{ transcript: 'Что-то уже сказано.', isFinal: true }])); });

    act(() => { result.current.cancel(); });
    expect(rec.abort).toHaveBeenCalledTimes(1);
    expect(onSessionEnd).not.toHaveBeenCalled();
    expect(result.current.liveText).toBe('');

    act(() => { rec.onend?.(); });
    expect(onSessionEnd).not.toHaveBeenCalled();
  });

  it('(d) браузер оборвал сессию сам → второй start на том же экземпляре, финалы сохранены, доставки нет', () => {
    const { result, onSessionEnd } = mount();
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); });
    act(() => { rec.onresult?.(resultEvent(0, [{ transcript: 'Первая.', isFinal: true }])); });

    act(() => { rec.onend?.(); });
    expect(instances).toHaveLength(1);
    expect(rec.start).toHaveBeenCalledTimes(2);
    expect(onSessionEnd).not.toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);

    // Новая сессия нумерует результаты с нуля; смещение не даёт затереть первую.
    act(() => { rec.onresult?.(resultEvent(0, [{ transcript: 'Вторая.', isFinal: true }])); });
    expect(result.current.liveText).toBe('Первая. Вторая.');
  });

  it('(d2) два перезапуска подряд без нового результата → тост об ошибке и доставка собранного', () => {
    const { result, onSessionEnd } = mount();
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); });
    act(() => { rec.onresult?.(resultEvent(0, [{ transcript: 'Единственное.', isFinal: true }])); });

    act(() => { rec.onend?.(); });   // первый перезапуск — разрешён
    act(() => { rec.onend?.(); });   // второй сразу без результатов — стоп

    expect(showToastMock).toHaveBeenCalled();
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    expect(onSessionEnd).toHaveBeenCalledWith('Единственное.');
    expect(rec.start).toHaveBeenCalledTimes(2);
  });

  it('(e) одно и то же событие индекса дважды (Android Chrome) → фраза стоит один раз', () => {
    const { result, onSessionEnd } = mount();
    act(() => { result.current.startListening(); });
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); });
    act(() => { rec.onresult?.(resultEvent(0, [{ transcript: 'Раз, два.', isFinal: true }])); });
    act(() => { rec.onresult?.(resultEvent(0, [{ transcript: 'Раз, два.', isFinal: true }])); });

    expect(result.current.liveText).toBe('Раз, два.');
    act(() => { result.current.stopListening(); });
    act(() => { rec.onend?.(); });
    expect(onSessionEnd).toHaveBeenCalledWith('Раз, два.');
  });

  it('(f) network с распознанным текстом → тост и доставка; no-speech без текста → ни того, ни другого', () => {
    const first = mount();
    act(() => { first.result.current.startListening(); });
    const recA = instances[0]!;
    act(() => { recA.onstart?.(); });
    act(() => { recA.onresult?.(resultEvent(0, [{ transcript: 'Успели поймать.', isFinal: true }])); });
    act(() => { recA.onerror?.({ error: 'network' }); });
    expect(showToastMock).toHaveBeenCalled();
    expect(first.onSessionEnd).toHaveBeenCalledWith('Успели поймать.');
    // onend после onerror не должен доставлять второй раз.
    act(() => { recA.onend?.(); });
    expect(first.onSessionEnd).toHaveBeenCalledTimes(1);

    showToastMock.mockClear();
    instances.length = 0;
    const second = mount();
    act(() => { second.result.current.startListening(); });
    const recB = instances[0]!;
    act(() => { recB.onstart?.(); });
    act(() => { recB.onerror?.({ error: 'no-speech' }); });
    expect(showToastMock).not.toHaveBeenCalled();
    expect(second.onSessionEnd).not.toHaveBeenCalled();
  });
});

describe('D-1: appendDictation — тот же способ вставки, что был у трёх потребителей', () => {
  const set = (v: string) => useContentStore.getState().setContent(v);

  it('пустая заметка → текст становится заметкой', () => {
    set('');
    appendDictation('Осень');
    expect(useContentStore.getState().content).toBe('Осень');
  });

  it('конец с переводом строки → одна вставка, без пустой строки', () => {
    set('Заметка\n');
    appendDictation('внизу');
    expect(useContentStore.getState().content).toBe('Заметка внизу');
  });

  it('текст без пробела на конце → пробел ставится между', () => {
    set('Было');
    appendDictation('стало');
    expect(useContentStore.getState().content).toBe('Было стало');
  });
});
