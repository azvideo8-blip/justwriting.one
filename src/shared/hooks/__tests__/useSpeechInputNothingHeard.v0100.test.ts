// Видео владельца 2026-10-17: запись остановлена, слов не распознано — и ничего
// не происходит: ни вставки, ни слова о том, что не расслышали. Человек думает,
// что сломалась кнопка. «Ничего не услышали» — тоже ответ, его надо сказать.
// Мутация: убрать тост пустой сессии → красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechInput } from '../useSpeechInput';
import { LanguageProvider } from '../../i18n';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('../../components/Toast', () => ({ useToast: () => ({ showToast }) }));

type Inst = { start: () => void; stop: () => void; abort: () => void; onstart: (() => void) | null; onend: (() => void) | null };
const instances: Inst[] = [];
class FakeRecognition implements Inst {
  continuous = false; interimResults = false; lang = '';
  onstart: (() => void) | null = null; onresult = null; onerror = null; onend: (() => void) | null = null;
  start = vi.fn(() => { this.onstart?.(); });
  stop = vi.fn(() => { this.onend?.(); });
  abort = vi.fn();
  constructor() { instances.push(this); }
}

describe('пустая сессия диктовки', () => {
  beforeEach(() => { instances.length = 0; showToast.mockReset(); (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition; });
  afterEach(() => { delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition; });

  it('«■» без распознанных слов — сообщение, а не тишина; вставки нет', () => {
    const onSessionEnd = vi.fn();
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    act(() => { result.current.stopListening(); });
    expect(onSessionEnd).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(String(showToast.mock.calls[0]![0])).toMatch(/не расслыш/i);
  });

  it('отмена (×) без слов — без сообщения', () => {
    const { result } = renderHook(() => useSpeechInput({ onSessionEnd: vi.fn() }), { wrapper: LanguageProvider });
    act(() => { result.current.startListening(); });
    act(() => { result.current.cancel(); });
    expect(showToast).not.toHaveBeenCalled();
  });
});
