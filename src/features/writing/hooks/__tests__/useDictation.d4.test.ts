// D-4: хук диктовки. Мокируются три строительных блока (сессия распознавания,
// уровень, пунктуация) — проверяется только то, что хук обязан гарантировать:
// порядок «сначала пунктуация, потом вставка», отмена без вставки, тост только на
// разговорные причины, таймаут 15 с, отмена при смене заметки и уступка микрофона
// волне (случай (e) из D-2).
//
// Мутации: вставить текст до разрешения пунктуации → (a) красный; убрать таймаут
// → (d) красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    },
  },
  meter: { level: 0.3, failed: false },
  punctuate: vi.fn(),
  willPunctuate: vi.fn(() => ({ yes: true, remaining: 7 })),
  isNoteHidden: vi.fn(async () => false),
  append: vi.fn(),
  showToast: vi.fn(),
  meta: { savedDocumentId: 'doc_1' as string | null },
}));

vi.mock('../useGuardedSpeechInput', () => ({
  useGuardedSpeechInput: (props: { onSessionEnd: (t: string) => void; onError?: (e: string) => void }) => {
    guarded.props = props;
    return guarded.current;
  },
}));

vi.mock('../../../../shared/hooks/useMicLevel', () => ({
  useMicLevel: () => meter,
}));

vi.mock('../appendDictation', () => ({ appendDictation: append }));

vi.mock('../../store/useSessionMetaStore', () => ({
  useSessionMetaStore: { getState: () => ({ savedDocumentId: meta.savedDocumentId }) },
}));

vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));

import { DICTATION_PUNCTUATE_TIMEOUT_MS, registerDictationAi, useDictation } from '../useDictation';

/** Настоящий путь: старт (он же снимает documentId), затем уже конец сессии. */
function startSession(result: { current: { toggle: () => void } }) {
  act(() => { result.current.toggle(); });
}

function endSession(text: string) {
  act(() => { guarded.props.onSessionEnd(text); });
}

function setListening(value: boolean) {
  guarded.current.isListening = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  guarded.current = {
    isListening: false,
    liveText: 'сказано вслух',
    interimText: '',
    hasSupport: true,
    isVaultActive: false,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    cancel: vi.fn(),
    toggleListening: vi.fn(async () => undefined),
  };
  meter.level = 0.3;
  meter.failed = false;
  meta.savedDocumentId = 'doc_1';
  willPunctuate.mockReturnValue({ yes: true, remaining: 7 });
  isNoteHidden.mockResolvedValue(false);
  registerDictationAi({ punctuate, willPunctuate, noteHidden: isNoteHidden });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('D-4: useDictation', () => {
  it('(a) конец сессии: сначала пунктуация, потом одна вставка её результата', async () => {
    punctuate.mockResolvedValue({ text: 'Сказано вслух.', punctuated: true });
    const { result } = renderHook(() => useDictation());
    startSession(result);

    act(() => { result.current.stop(); });
    expect(guarded.current.stopListening).toHaveBeenCalledTimes(1);

    endSession('сказано вслух');
    await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    expect(punctuate).toHaveBeenCalledWith('сказано вслух', { documentId: 'doc_1' });
    expect(append).toHaveBeenCalledWith('Сказано вслух.');
    expect(showToast).not.toHaveBeenCalled();
    // вставка ровно одна: опоздавшая «сырая» вставка до или после пунктуации —
    // это удвоенный текст в заметке
    await act(async () => { await Promise.resolve(); });
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('(b) отмена: ни пунктуации, ни вставки', () => {
    const { result } = renderHook(() => useDictation());
    act(() => { result.current.cancel(); });
    expect(guarded.current.cancel).toHaveBeenCalledTimes(1);
    expect(punctuate).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('(c) отказ пунктуации: вставляется исходник и один тост с причиной', async () => {
    punctuate.mockResolvedValue({ text: 'сказано вслух', punctuated: false, reason: 'limit' });
    const started = renderHook(() => useDictation());
    startSession(started.result);
    endSession('сказано вслух');
    await waitFor(() => expect(append).toHaveBeenCalledWith('сказано вслух'));
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0]?.[0]).toContain('voice_no_punctuation_toast');
    expect(showToast.mock.calls[0]?.[1]).toBe('info');
  });

  it('молчаливые причины (не вошёл, нет согласия, скрытая заметка) тоста не дают', async () => {
    for (const reason of ['not-signed-in', 'no-consent', 'note-hidden'] as const) {
      punctuate.mockResolvedValue({ text: 'сказано вслух', punctuated: false, reason });
      const { result, unmount } = renderHook(() => useDictation());
      startSession(result);
      endSession('сказано вслух');
      await waitFor(() => expect(append).toHaveBeenCalledWith('сказано вслух'));
      expect(showToast).not.toHaveBeenCalled();
      expect(result.current.phase).toBe('idle');
      unmount();
      vi.clearAllMocks();
      punctuate.mockResolvedValue({ text: 'сказано вслух', punctuated: false, reason });
    }
  });

  it('(d) пунктуация зависла: по таймауту вставляется исходник', async () => {
    vi.useFakeTimers();
    punctuate.mockReturnValue(new Promise(() => undefined));
    const started = renderHook(() => useDictation());
    startSession(started.result);
    guarded.props.onSessionEnd('сказано вслух');
    await vi.advanceTimersByTimeAsync(DICTATION_PUNCTUATE_TIMEOUT_MS + 50);
    expect(append).toHaveBeenCalledWith('сказано вслух');
    expect(showToast).toHaveBeenCalledTimes(1); // reason error по таймауту
  });

  it('опоздавший ответ ИИ после таймаута не вставляется вторично', async () => {
    vi.useFakeTimers();
    let resolveLate: ((v: { text: string; punctuated: boolean }) => void) | undefined;
    punctuate.mockReturnValue(new Promise(r => { resolveLate = r; }));
    const started = renderHook(() => useDictation());
    startSession(started.result);
    guarded.props.onSessionEnd('сказано вслух');
    await vi.advanceTimersByTimeAsync(DICTATION_PUNCTUATE_TIMEOUT_MS + 50);
    expect(append).toHaveBeenCalledTimes(1);
    await act(async () => { resolveLate?.({ text: 'Сказано вслух.', punctuated: true }); });
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('(e) смена заметки во время записи отменяет сессию и ничего не вставляет', async () => {
    punctuate.mockResolvedValue({ text: 'Сказано вслух.', punctuated: true });
    const started = renderHook(() => useDictation());
    startSession(started.result);
    setListening(true);
    started.rerender();
    meta.savedDocumentId = 'doc_other';
    await waitFor(() => expect(guarded.current.cancel).toHaveBeenCalled());
    expect(append).not.toHaveBeenCalled();
  });

  // Ревью D (09.10): пунктуация идёт до 15 с после Stop — за это время человек
  // успевает открыть другую заметку. Мутация: вернуть прямой appendDictation в
  // handleSessionEnd → (g) красный; убрать offerCopy из автоотмены → (h) красный.
  it('(g) заметку сменили, пока шла пунктуация: в чужую не вставляется, текст отдаётся копированием', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    let resolvePunct: ((v: { text: string; punctuated: boolean }) => void) | undefined;
    punctuate.mockReturnValue(new Promise(r => { resolvePunct = r; }));
    const started = renderHook(() => useDictation());
    startSession(started.result);
    endSession('сказано вслух');
    meta.savedDocumentId = 'doc_other';
    await act(async () => { resolvePunct?.({ text: 'Сказано вслух.', punctuated: true }); });
    expect(append).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, type, action] = showToast.mock.calls[0] as [string, string, { label: string; onClick: () => void }];
    expect(message).toBe('voice_not_inserted_note_changed');
    expect(type).toBe('warning');
    expect(action.label).toBe('voice_copy_text');
    action.onClick();
    expect(writeText).toHaveBeenCalledWith('Сказано вслух.');
    started.unmount();
  });

  it('(h) автоотмена при смене заметки во время записи отдаёт сказанное копированием', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const started = renderHook(() => useDictation());
    startSession(started.result);
    setListening(true);
    started.rerender();
    meta.savedDocumentId = 'doc_other';
    await waitFor(() => expect(guarded.current.cancel).toHaveBeenCalled());
    const call = showToast.mock.calls.find(c => c[0] === 'voice_cancelled_note_changed') as [string, string, { onClick: () => void }] | undefined;
    expect(call).toBeDefined();
    call?.[2].onClick();
    expect(writeText).toHaveBeenCalledWith('сказано вслух');
    // Хост держит модульный стор диктовки: без размонтирования следующий тест
    // проксировал бы команды в этот экземпляр.
    started.unmount();
  });

  it('(f) ИИ-метка: есть запрос → остаток виден; нет аккаунта → метки нет, текст всё равно вставляется', async () => {
    punctuate.mockResolvedValue({ text: 'Сказано вслух.', punctuated: true });
    const { result, rerender } = renderHook(() => useDictation());
    startSession(result);
    expect(result.current.aiNoticeRemaining).toBe(7);

    willPunctuate.mockReturnValue({ yes: false, remaining: 0 });
    const second = renderHook(() => useDictation());
    startSession(second.result);
    expect(second.result.current.aiNoticeRemaining).toBeNull();
    // Конец сессии приходит от движка хоста (второй экземпляр только проксирует
    // команды); мок распознавания общий, поэтому обработчик берётся у хоста.
    rerender();
    endSession('сказано вслух');
    await waitFor(() => expect(append).toHaveBeenCalledWith('Сказано вслух.'));
  });

  it('(e из D-2) конфликт микрофона: метр уступает, распознавание стартует ещё раз', async () => {
    punctuate.mockResolvedValue({ text: 'x', punctuated: true });
    const started = renderHook(() => useDictation());
    startSession(started.result);
    setListening(true);
    started.rerender(); // метр активен, пока идёт запись

    act(() => { guarded.props.onError?.('audio-capture'); });
    await waitFor(() => expect(guarded.current.startListening).toHaveBeenCalledTimes(1));
    expect(started.result.current.levelFailed).toBe(true);

    act(() => { guarded.props.onError?.('audio-capture'); });
    await waitFor(() => expect(guarded.current.startListening).toHaveBeenCalledTimes(1), { timeout: 200 });
  });

  it('кнопка на не-хосте проксирует команды хосту и показывает его снимок', async () => {
    punctuate.mockResolvedValue({ text: 'Сказано вслух.', punctuated: true });
    const host = renderHook(() => useDictation());
    const second = renderHook(() => useDictation());

    act(() => { second.result.current.stop(); });
    await waitFor(() => expect(guarded.current.stopListening).toHaveBeenCalled());
    expect(second.result.current.liveText).toBe(host.result.current.liveText);
  });
});
