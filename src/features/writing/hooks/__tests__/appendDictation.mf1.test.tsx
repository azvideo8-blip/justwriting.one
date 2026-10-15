// MF-1: диктовка до первой буквы не считалась. Вставка шла мимо событий
// редактора, сессия оставалась в `idle`, «Готово» было серым, а первая буква
// потом брала продиктованное в точку отсчёта. Путь общий для телефона и
// десктопа (все три кнопки микрофона вставляют через appendDictation).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { appendDictation } from '../appendDictation';
import { useContentStore } from '../../store/useContentStore';
import { useTimerStore } from '../../store/useTimerStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';
import { calculateSessionFinishStats } from '../../components/WritingFinishModal';
import { MobileWriteToolbar } from '../../components/MobileWriteToolbar';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    aiPanelOpen: false,
    setAiPanelOpen: vi.fn(),
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('../useDictation', () => ({
  useDictation: () => ({ isListening: false, phase: 'idle', toggle: vi.fn(), hasSupport: true, isVaultActive: false, aiNoticeRemaining: null }),
}));

const TEN = 'один два три четыре пять шесть семь восемь девять десять';

function seed(content: string) {
  useContentStore.setState({ content, wordCount: content ? content.split(' ').length : 0, initialWordCount: 0, wpmHistory: [] });
  useContentStore.getState().recalcStats();
  useTimerStore.setState({ status: 'idle', sessionType: 'free', seconds: 0, timerDuration: 0, wordGoal: 0, sessionStartWords: 0, sessionStartSeconds: 0 } as Partial<ReturnType<typeof useTimerStore.getState>>);
  useSessionMetaStore.setState({ sessionStartTime: null });
}

function sessionWords(): number {
  const c = useContentStore.getState();
  return calculateSessionFinishStats({
    accumulatedDuration: 0, seconds: 0, sessionStartSeconds: 0, initialDuration: 0,
    wordCount: c.wordCount, initialWordCount: c.initialWordCount,
  }).sessionWords;
}

describe('MF-1: dictation is a first input', () => {
  beforeEach(() => cleanup());

  it('idle, empty note → dictation starts the session and counts 3 words; «Готово» is enabled', () => {
    seed('');
    appendDictation('раз два три');
    useContentStore.getState().recalcStats();
    expect(useTimerStore.getState().status).toBe('writing');
    expect(useContentStore.getState().wordCount - useTimerStore.getState().sessionStartWords).toBe(3);
    expect(sessionWords()).toBe(3);
    render(<MobileWriteToolbar onStop={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'topbar_save' })).toBeEnabled();
  });

  it('idle, note has 10 words → dictation of 3 counts 3 (not 13, not 0)', () => {
    seed(TEN);
    appendDictation('раз два три');
    useContentStore.getState().recalcStats();
    expect(useContentStore.getState().wordCount).toBe(13);
    expect(useTimerStore.getState().sessionStartWords).toBe(10);
    expect(sessionWords()).toBe(3);
  });

  it('a running session keeps its baseline', () => {
    seed(TEN);
    useTimerStore.setState({ status: 'writing', sessionStartWords: 4 });
    useSessionMetaStore.setState({ sessionStartTime: 1 });
    useContentStore.setState({ initialWordCount: 4 });
    appendDictation('раз два три');
    useContentStore.getState().recalcStats();
    expect(useTimerStore.getState().sessionStartWords).toBe(4);
    expect(sessionWords()).toBe(9);
  });
});
