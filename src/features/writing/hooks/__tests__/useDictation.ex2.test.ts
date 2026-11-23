// EX-2 (PIN-1, диктовка): тост «ошибка» при пунктуации, которая не успела за таймаут.
// Распознавание на краю — мок `useGuardedSpeechInput`, как в соседних тестах хука;
// сама пунктуация — мок `punctuate` (сеть/ИИ). Таймаут — настоящий, через фейковые таймеры.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { guarded, meter, punctuate, willPunctuate, isNoteHidden, append, showToast, meta } = vi.hoisted(() => ({
  guarded: {
    current: {
      isListening: false, liveText: '', interimText: '', hasSupport: true, isVaultActive: false,
      startListening: vi.fn(), stopListening: vi.fn(), cancel: vi.fn(),
      toggleListening: vi.fn(async () => undefined),
    },
    props: { onSessionEnd: (_t: string): void => undefined } as {
      onSessionEnd: (t: string) => void; onError?: ((e: string) => void) | undefined;
    },
  },
  meter: { level: 0.3, failed: false },
  punctuate: vi.fn(),
  willPunctuate: vi.fn(() => ({ yes: true, remaining: 7 })),
  isNoteHidden: vi.fn(async () => false),
  append: vi.fn(),
  showToast: vi.fn(),
  meta: { savedDocumentId: 'doc_1' as string | null, draftNonce: 'draft-1' },
}));

vi.mock('../useGuardedSpeechInput', () => ({
  useGuardedSpeechInput: (props: { onSessionEnd: (t: string) => void; onError?: (e: string) => void }) => {
    guarded.props = props;
    return guarded.current;
  },
}));
vi.mock('../../../../shared/hooks/useMicLevel', () => ({ useMicLevel: () => meter }));
vi.mock('../appendDictation', () => ({ appendDictation: append }));
vi.mock('../../store/useSessionMetaStore', () => ({
  useSessionMetaStore: { getState: () => ({ savedDocumentId: meta.savedDocumentId, draftNonce: meta.draftNonce }) },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }) }));

import { registerDictationAi, useDictation, DICTATION_PUNCTUATE_TIMEOUT_MS } from '../useDictation';

describe('EX-2: useDictation — пунктуация не успела за таймаут', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guarded.current = {
      isListening: false, liveText: 'глина сохнет', interimText: '', hasSupport: true, isVaultActive: false,
      startListening: vi.fn(), stopListening: vi.fn(), cancel: vi.fn(),
      toggleListening: vi.fn(async () => undefined),
    };
    meter.level = 0.3;
    meter.failed = false;
    meta.savedDocumentId = 'doc_1';
    meta.draftNonce = 'draft-1';
    willPunctuate.mockReturnValue({ yes: true, remaining: 7 });
    isNoteHidden.mockResolvedValue(false);
    registerDictationAi({ punctuate, willPunctuate, noteHidden: isNoteHidden });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('таймаут пунктуации: текст вставлен как есть, тост с причиной «ошибка» (info), не успех', async () => {
    vi.useFakeTimers();
    punctuate.mockReturnValue(new Promise(() => undefined)); // ответа не приходит
    const { result } = renderHook(() => useDictation());
    act(() => { result.current.toggle(); });
    act(() => { result.current.stop(); });
    act(() => { guarded.props.onSessionEnd('глина сохнет'); });

    await act(async () => { await vi.advanceTimersByTimeAsync(DICTATION_PUNCTUATE_TIMEOUT_MS); });

    expect(append).toHaveBeenCalledWith('глина сохнет');
    expect(showToast).toHaveBeenCalledWith(
      'voice_no_punctuation_toast:{"reason":"voice_no_punctuation_reason_error"}',
      'info',
    );
  });
});
