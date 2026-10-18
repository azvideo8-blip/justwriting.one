// N-1 (решение владельца 2026-10-18): офлайн-диктовка. Хук обязан (1) сказать про
// отсутствие сети до старта, (2) вставить исходный текст, если пунктуация
// недоступна, и не звать ИИ без действия человека.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

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

import { registerDictationAi, useDictation } from '../useDictation';

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

describe('N-1: useDictation без сети', () => {
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
    setOnline(true);
  });
  afterEach(() => { setOnline(true); });

  it('перед стартом без сети говорит правду сразу — и всё равно начинает запись', () => {
    setOnline(false);
    const { result } = renderHook(() => useDictation());
    act(() => { result.current.toggle(); });
    expect(showToast).toHaveBeenCalledWith('voice_offline_before_start', 'info');
    expect(guarded.current.toggleListening).toHaveBeenCalledTimes(1);
  });

  it('с сетью предупреждения нет (регрессия: не пугать зря)', () => {
    const { result } = renderHook(() => useDictation());
    act(() => { result.current.toggle(); });
    expect(showToast).not.toHaveBeenCalledWith('voice_offline_before_start', 'info');
  });

  it('без сети исходник вставляется и сохраняется, а тост называет следствие', async () => {
    // Пунктуация офлайн не удаётся: провайдер возвращает исходный текст с причиной.
    punctuate.mockResolvedValue({ text: 'глина сохнет', punctuated: false, reason: 'offline' });
    const { result } = renderHook(() => useDictation());
    act(() => { result.current.toggle(); });
    act(() => { result.current.stop(); });
    act(() => { guarded.props.onSessionEnd('глина сохнет'); });

    await waitFor(() => expect(append).toHaveBeenCalledWith('глина сохнет'));
    const said = showToast.mock.calls.map(c => String(c[0])).join(' | ');
    expect(said).toContain('voice_no_punctuation_reason_offline');
  });

  it('копия офлайн-отказа называет следствие, а не только «нет сети»', async () => {
    const { writingTranslations: dict } = await import('../../../../shared/i18n/translations/writing');
    const reason = dict.voice_no_punctuation_reason_offline!.ru;
    const noRecognition = dict.voice_offline_no_recognition!.ru;
    const beforeStart = dict.voice_offline_before_start!.ru;
    expect(reason).toContain('без обработки');
    expect(noRecognition).toContain('распознавание речи недоступно');
    expect(beforeStart).toContain('без обработки');
    // «ты», без рода: в этих трёх строках нет глаголов прошедшего времени.
    for (const text of [reason, noRecognition, beforeStart]) {
      expect(text).not.toMatch(/сделал|вставил|потерял|записал/);
    }
    expect(dict.voice_offline_no_recognition!.en).toBeTruthy();
    expect(dict.voice_offline_before_start!.en).toBeTruthy();
  });
});
