// NB-2 (sus02): «Скопировать текст» в тосте диктовки отказал — сказанное не
// теряется молча: ошибка названа, текст отдаётся в самом тосте (выделить и
// скопировать вручную), кнопка — повторная попытка тем же жестом.
// Мутация: вернуть void navigator.clipboard?.writeText(text).catch(() => undefined)
// → случай отказа красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { guarded, meter, punctuate, willPunctuate, isNoteHidden, append, showToast, meta } = vi.hoisted(() => ({
  guarded: {
    current: {
      isListening: false,
      liveText: '',
      interimText: '',
      hasSupport: true,
      isVaultActive: false,
      startListening: vi.fn(),
      stopListening: vi.fn(),
      cancel: vi.fn(),
      toggleListening: vi.fn(async () => undefined),
    },
    props: { onSessionEnd: (_t: string): void => undefined } as {
      onSessionEnd: (t: string) => void; onError?: ((e: string) => void) | undefined;
      onUnmountText?: ((t: string) => void) | undefined;
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
  useGuardedSpeechInput: (props: { onSessionEnd: (t: string) => void; onError?: (e: string) => void; onUnmountText?: (t: string) => void }) => {
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
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));

import { registerDictationAi, useDictation } from '../useDictation';

const TEXT = 'MARKER_SUS02_сказанное';

function offerCopyToast() {
  const call = showToast.mock.calls.find(c => c[0] === 'voice_left_screen_copy') as
    [string, string, { label: string; onClick: () => void }] | undefined;
  expect(call).toBeDefined();
  expect(call![1]).toBe('warning');
  // Ревью выпуска 0.11.24: сказанное живёт только в этом тосте — висит минуту.
  // Мутация: тост предложения без { durationMs } — красный.
  expect((call as unknown[])[3]).toEqual({ durationMs: 60_000 });
  return call![2];
}

beforeEach(() => {
  vi.clearAllMocks();
  guarded.current = {
    isListening: false, liveText: '', interimText: '', hasSupport: true, isVaultActive: false,
    startListening: vi.fn(), stopListening: vi.fn(), cancel: vi.fn(),
    toggleListening: vi.fn(async () => undefined),
  };
  registerDictationAi({ punctuate, willPunctuate, noteHidden: isNoteHidden });
});

describe('NB-2 sus02: dictation copy refusal is named', () => {
  it('writeText отказал → error-тост с текстом и повторной кнопкой', async () => {
    const writeText = vi.fn(async () => { throw new Error('clipboard denied'); });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { unmount } = renderHook(() => useDictation());
    act(() => { guarded.props.onUnmountText?.(TEXT); });
    const action = offerCopyToast();
    act(() => { action.onClick(); });
    await waitFor(() => {
      const err = showToast.mock.calls.find(c => c[1] === 'error');
      expect(err).toBeDefined();
      expect(String(err![0])).toContain('voice_copy_failed');
      expect(String(err![0])).toContain(TEXT);
      expect(err![2]?.label).toBe('voice_copy_text');
      // Ревью 0.11.24, N-4: тост с текстом висит минуту — за 3 с его не выделить.
      // Мутация: убрать { durationMs } — красный.
      expect(err![3]).toEqual({ durationMs: 60_000 });
    });
    expect(writeText).toHaveBeenCalledWith(TEXT);
    unmount();
  });

  it('контроль: буфер принял текст → ошибки нет', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { unmount } = renderHook(() => useDictation());
    act(() => { guarded.props.onUnmountText?.(TEXT); });
    const action = offerCopyToast();
    await act(async () => { action.onClick(); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith(TEXT);
    expect(showToast.mock.calls.filter(c => c[1] === 'error')).toHaveLength(0);
    unmount();
  });
});