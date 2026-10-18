// N-6 (emil-review, хвост MQ-15): при старте и остановке записи вся строка панели
// менялась в один кадр, а на «processing» ■ пропадал — волна рывком расширялась на
// освободившиеся 44 px. Правка: обе ветки живут в одном AnimatePresence с ключами
// (кроссфейд 150 мс + blur 2 px), и на «processing» ■ держит место через visibility.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MobileWriteToolbar } from '../components/MobileWriteToolbar';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';

const dictation = vi.hoisted(() => ({ current: { phase: 'idle' as string } }));

vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    aiPanelOpen: false,
    setAiPanelOpen: vi.fn(),
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('../hooks/useDictation', () => ({
  previewDictationCost: () => 0,
  useDictation: () => ({
    isListening: dictation.current.phase !== 'idle',
    hasSupport: true,
    phase: dictation.current.phase,
    isVaultActive: false,
    aiNoticeRemaining: null,
    cancel: vi.fn(),
    stop: vi.fn(),
    level: 0.3,
    levels: [0.2, 0.4],
    levelFailed: false,
    interimText: '',
    liveText: '',
    seconds: 4,
  }),
}));

function setPhase(p: string) {
  dictation.current.phase = p;
  cleanup();
  render(<MobileWriteToolbar onStop={vi.fn()} />);
}

describe('N-6: строка панели переключается, а не подменяется', () => {
  beforeEach(() => {
    dictation.current.phase = 'idle';
    useContentStore.setState({ content: 'текст', wordCount: 5, wpm: 10, wpmHistory: [] });
    useTimerStore.setState({
      status: 'writing', sessionType: 'free', seconds: 30, wordGoal: 0, timerDuration: 0,
      sessionStartWords: 0, sessionStartSeconds: 0,
    } as Partial<ReturnType<typeof useTimerStore.getState>>);
  });

  it('обычная строка и строка записи — два именованных слота одного ряда', () => {
    setPhase('idle');
    expect(document.querySelector('[data-idle-row]'), 'нет размеченной idle-ветки').not.toBeNull();
    setPhase('recording');
    expect(document.querySelector('[data-dictation-row]')).not.toBeNull();
    expect(document.querySelector('[data-idle-row]'), 'обе ветки в DOM одновременно').toBeNull();
  });

  // U-18 (2026-10-18): как на десктопе — на «processing» «Стоп» остаётся в ряду
  // и гаснет (не исчезает): место держится, волна не прыгает.
  it('на «processing» «Стоп» остаётся в ряду, погашен и не доступен', () => {
    setPhase('processing');
    const stop = screen.getByRole('button', { name: 'voice_stop_dictation' });
    expect(stop.className).toContain('text-text-main/30');
    expect(stop).toBeDisabled();
  });

  it('в записи ■ виден и кликабелен', () => {
    setPhase('recording');
    const stop = screen.getByRole('button', { name: 'voice_stop_dictation' });
    expect(stop.className).not.toContain('invisible');
    expect(stop).not.toBeDisabled();
  });
});
