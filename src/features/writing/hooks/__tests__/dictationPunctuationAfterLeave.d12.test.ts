// П-1 (аудит 02.11): «Стоп → уход с экрана → ответ пунктуации». Проверяется
// настоящий persistDraft + IndexedDB и настоящий путь вставки appendDictation;
// мокается только распознавание (его сессию закрывает человек) и тост.
// Синтетические маркеры MARKER_D12_П1, живых данных нет.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { guarded, punctuate, showToast } = vi.hoisted(() => ({
  guarded: {
    current: {
      isListening: false, liveText: '', interimText: '', hasSupport: true, isVaultActive: false,
      startListening: vi.fn(),
      stopListening: vi.fn(),
      cancel: vi.fn(),
      toggleListening: vi.fn(async () => undefined),
    },
    props: { onSessionEnd: (_t: string): void => undefined } as {
      onSessionEnd: (t: string) => void;
      onError?: ((e: string) => void) | undefined;
    },
  },
  punctuate: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../useGuardedSpeechInput', () => ({
  useGuardedSpeechInput: (props: { onSessionEnd: (t: string) => void; onError?: (e: string) => void }) => {
    guarded.props = props;
    return guarded.current;
  },
}));
vi.mock('../../../../shared/hooks/useMicLevel', () => ({ useMicLevel: () => ({ level: 0.2, failed: false }) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'ru' }) }));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'desktop' }) }));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../../../core/auth/accountReload', () => ({
  onBeforeAccountReload: () => () => {},
  isAccountReloadPending: () => false,
}));

import { DICTATION_PUNCTUATE_TIMEOUT_MS, registerDictationAi, useDictation } from '../useDictation';
import { useDraftAutosave } from '../useDraftAutosave';
import { getLocalDb } from '../../../../core/storage/localDb';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import type { AppUser } from '../../../../core/auth/types';

const user = { uid: 'd12_p1_user' } as AppUser;
const START = 'НАЧАЛО-П1';
const SAID = 'MARKER_D12_П1';

const draftData = {
  title: 'П1',
  content: START,
  pinnedThoughts: [] as string[],
  seconds: 3,
  wpm: 10,
  wordCount: 1,
  initialWordCount: 0,
  sessionStartTime: undefined,
  activeSessionId: null,
  status: 'writing' as const,
};

async function localDraftContent(): Promise<string | undefined> {
  const db = await getLocalDb(user.uid);
  return (await db.get('drafts', user.uid))?.content;
}

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  useContentStore.setState({
    content: START,
    title: 'П1',
    pinnedThoughts: [],
    wordCount: 1,
    ownerUid: user.uid,
  });
  useTimerStore.setState({ status: 'writing' });
  useSessionMetaStore.getState().resetSessionMetadata();
  registerDictationAi({
    punctuate,
    willPunctuate: () => ({ yes: false, remaining: 0 }),
    noteHidden: async () => true,
  });
  const db = await getLocalDb(user.uid);
  await db.clear('drafts');
});

describe('П-1: пунктуация после ухода с экрана', () => {
  it('не оставляет сказанное только в памяти вкладки — текст либо в черновике, либо отдан копированием', async () => {
    const autosave = renderHook(() => useDraftAutosave(user, draftData));
    await waitFor(async () => {
      expect(await localDraftContent()).toBe(START);
    }, { timeout: 3000 });

    let resolvePunct: ((v: { text: string; punctuated: boolean }) => void) | undefined;
    punctuate.mockReturnValue(new Promise(r => { resolvePunct = r; }));

    const dictation = renderHook(() => useDictation());
    act(() => { dictation.result.current.toggle(); });
    act(() => { guarded.props.onSessionEnd(SAID); });

    // Человек уходит с экрана, пока пунктуация ещё идёт: экран и его
    // автосохранение размонтированы целиком.
    dictation.unmount();
    autosave.unmount();
    await new Promise(r => setTimeout(r, 50));

    await act(async () => {
      resolvePunct?.({ text: `${SAID}.`, punctuated: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect({
      store: useContentStore.getState().content,
      draftOnDisk: await localDraftContent(),
    }, 'вставка в стор после ухода не должна молча остаться без автосохранения').toEqual({
      store: START,
      draftOnDisk: START,
    });
    const copyToast = showToast.mock.calls.find(c => c[0] === 'voice_left_screen_copy');
    expect(copyToast, 'сказанное отдаётся тостом с копированием').toBeDefined();
  });

  it('таймаут пунктуации после ухода тоже отдаёт текст копированием', async () => {
    const autosave = renderHook(() => useDraftAutosave(user, draftData));
    await waitFor(async () => {
      expect(await localDraftContent()).toBe(START);
    }, { timeout: 3000 });

    punctuate.mockReturnValue(new Promise(() => undefined));
    vi.useFakeTimers();
    try {
      const dictation = renderHook(() => useDictation());
      act(() => { dictation.result.current.toggle(); });
      act(() => { guarded.props.onSessionEnd(SAID); });

      dictation.unmount();
      autosave.unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DICTATION_PUNCTUATE_TIMEOUT_MS + 50);
      });
    } finally {
      vi.useRealTimers();
    }

    expect({
      store: useContentStore.getState().content,
      draftOnDisk: await localDraftContent(),
    }, 'по таймауту после ухода текст не должен уйти в стор без автосохранения').toEqual({
      store: START,
      draftOnDisk: START,
    });
    const copyToast = showToast.mock.calls.find(c => c[0] === 'voice_left_screen_copy');
    expect(copyToast, 'таймаут после ухода тоже отдаёт текст человеку').toBeDefined();
  });
});
