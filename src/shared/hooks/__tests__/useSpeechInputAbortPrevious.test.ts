import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechInput } from '../useSpeechInput';
import { LanguageProvider } from '../../i18n';

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

describe('B-5.5 (F-014) useSpeechInput aborts previous recognition engine before starting a new one', () => {
  const instances: Array<{
    start: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];

  class MockSpeechRecognition {
    start = vi.fn();
    abort = vi.fn();
    stop = vi.fn();
    continuous = false;
    interimResults = false;
    lang = '';
    onstart: (() => void) | null = null;
    onresult: ((e: any) => void) | null = null;
    onerror: ((e: any) => void) | null = null;
    onend: (() => void) | null = null;

    constructor() {
      instances.push(this);
    }
  }

  beforeEach(() => {
    instances.length = 0;
    (window as any).SpeechRecognition = MockSpeechRecognition;
  });

  afterEach(() => {
    delete (window as any).SpeechRecognition;
  });

  it('aborts the first recognition engine when startListening is called a second time', () => {
    const { result } = renderHook(() => useSpeechInput({ onTranscript: vi.fn() }), { wrapper: LanguageProvider });

    act(() => {
      result.current.startListening();
    });

    expect(instances).toHaveLength(1);
    expect(instances[0]!.abort).not.toHaveBeenCalled();

    act(() => {
      result.current.startListening();
    });

    expect(instances).toHaveLength(2);
    // On unpatched code, instances[0] was never aborted when the second instance started
    expect(instances[0]!.abort).toHaveBeenCalledTimes(1);
  });
});
