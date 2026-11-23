// EX-2 (PIN-1, диктовка): закрепить защитные тосты распознавания, которых не было
// в тестах. Хук настоящий; подменяется только движок — `window.SpeechRecognition`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechInput } from '../useSpeechInput';
import { LanguageProvider } from '../../i18n';
import { writingTranslations as dict } from '../../i18n/translations/writing';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../../components/Toast', () => ({ useToast: () => ({ showToast }) }));

type Handlers = {
  onstart: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
const instances: (Handlers & { start: () => void; stop: () => void; abort: () => void })[] = [];
let autoStart = true;

class FakeRecognition implements Handlers {
  continuous = false; interimResults = false; lang = '';
  onstart: (() => void) | null = null;
  onresult = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => { if (autoStart) this.onstart?.(); });
  stop = vi.fn(() => { this.onend?.(); });
  abort = vi.fn();
  constructor() { instances.push(this); }
}

const engine = () => instances[instances.length - 1]!;

describe('EX-2: защитные тосты распознавания', () => {
  beforeEach(() => {
    instances.length = 0;
    autoStart = true;
    showToast.mockReset();
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  });
  afterEach(() => {
    vi.useRealTimers();
    autoStart = true;
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it('onerror с прочим кодом — тост «Ошибка диктовки: код» (error), код уходит наружу', () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd: vi.fn(), onError }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    act(() => { engine().onerror?.({ error: 'audio-capture' }); });
    expect(onError).toHaveBeenCalledWith('audio-capture');
    expect(showToast).toHaveBeenCalledWith(`${dict.voice_error!.ru}: audio-capture`, 'error');
  });

  it('второй обрыв сразу после перезапуска без слов — «no-restart» (error), движок не оживляют', () => {
    const onSessionEnd = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    act(() => { engine().onend?.(); }); // браузер оборвал: перезапуск
    expect(showToast).not.toHaveBeenCalled();
    act(() => { engine().onend?.(); }); // ещё раз без единого результата
    expect(showToast).toHaveBeenCalledWith(`${dict.voice_error!.ru}: no-restart`, 'error');
  });

  it('перезапуск без onstart дольше сторожа — «браузер прервал запись» (warning)', () => {
    vi.useFakeTimers();
    autoStart = false;
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd: vi.fn() }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    act(() => { engine().onend?.(); }); // браузер оборвал: перезапуск, onstart не приходит
    expect(showToast).not.toHaveBeenCalledWith(dict.voice_stopped_by_browser!.ru, 'warning');
    act(() => { vi.advanceTimersByTime(4000); });
    expect(showToast).toHaveBeenCalledWith(dict.voice_stopped_by_browser!.ru, 'warning');
  });
});
