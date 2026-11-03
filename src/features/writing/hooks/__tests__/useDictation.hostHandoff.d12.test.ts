// D12: хостинг диктовки передаётся, а не исчезает вместе с размонтированной
// кнопкой. Здесь настоящие useDictation + useGuardedSpeechInput + useSpeechInput;
// мокается только край: браузерное распознавание, метр, тост, ИИ-мост, стор мета.
// Синтетические маркеры MARKER_D12_*, живых данных нет.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { showToast, append } = vi.hoisted(() => ({
  showToast: vi.fn(),
  append: vi.fn(),
}));

vi.mock('@/shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'ru' }) }));
vi.mock('@/shared/hooks/useMicLevel', () => ({ useMicLevel: () => ({ level: 0.2, failed: false }) }));
vi.mock('@/features/writing/hooks/appendDictation', () => ({ appendDictation: append }));
vi.mock('@/features/writing/store/useSessionMetaStore', () => ({
  useSessionMetaStore: { getState: () => ({ savedDocumentId: null, draftNonce: 'draft-d12' }) },
}));
vi.mock('@/shared/components/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: async () => true }),
}));
vi.mock('@/app/useAuthStatus', () => ({ useAuthStatus: () => ({ user: null }) }));
vi.mock('@/core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: { getState: () => ({ getEncryptionEnabled: () => false }) },
}));

import { useDictation } from '../useDictation';

interface Rec {
  continuous: boolean; interimResults: boolean; lang: string;
  onstart: (() => void) | null;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
}
const instances: Rec[] = [];
class Mock implements Rec {
  continuous = false; interimResults = false; lang = '';
  onstart: Rec['onstart'] = null; onresult: Rec['onresult'] = null;
  onerror: Rec['onerror'] = null; onend: Rec['onend'] = null;
  start = vi.fn();
  stop = vi.fn(() => { setTimeout(() => this.onend?.(), 0); });
  abort = vi.fn(() => { setTimeout(() => this.onend?.(), 0); });
  constructor() { instances.push(this); }
}
function finalEvent(i: number, transcript: string) {
  const r = [{ 0: { transcript }, isFinal: true }];
  return { resultIndex: i, results: Object.assign(r, { length: 1 }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  instances.length = 0;
  vi.useFakeTimers();
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = Mock;
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe('D12: хост диктовки размонтирован во время записи', () => {
  it('сказанное отдаётся человеку, а оставшаяся кнопка начинает новую запись', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const host = renderHook(() => useDictation());
    const surviving = renderHook(() => useDictation());
    await act(async () => { host.result.current.toggle(); });
    expect(instances).toHaveLength(1);
    const rec = instances[0]!;
    act(() => { rec.onstart?.(); rec.onresult?.(finalEvent(0, 'MARKER_D12_ушёл')); });
    expect(host.result.current.liveText).toBe('MARKER_D12_ушёл');

    // Шапка ушла в ветку LifeLog: Toolbar размонтирован, сессия закрыта.
    act(() => { host.unmount(); });
    act(() => { vi.advanceTimersByTime(50); });

    const copyCall = showToast.mock.calls.find(c => c[0] === 'voice_left_screen_copy') as
      [string, string, { label: string; onClick: () => void }] | undefined;
    expect(copyCall?.[1], 'текст отдаётся тостом с копированием').toBe('warning');
    expect(copyCall?.[2].label).toBe('voice_copy_text');
    copyCall?.[2].onClick();
    expect(writeText).toHaveBeenCalledWith('MARKER_D12_ушёл');
    expect(append, 'в размонтированный экран ничего не вставляется').not.toHaveBeenCalled();
    expect(surviving.result.current.phase).toBe('idle');

    // Оставшаяся кнопка (BottomStats) заявляется сама и начинает новую сессию.
    await act(async () => { surviving.result.current.toggle(); });
    expect(instances).toHaveLength(2);
    expect(instances[1]!.start).toHaveBeenCalledTimes(1);
    act(() => { instances[1]!.onstart?.(); });
    expect(surviving.result.current.isListening).toBe(true);
    expect(surviving.result.current.liveText).toBe('');
    surviving.unmount();
  });
});
