// Q-11 (решение владельца 2026-10-18): полоса слов на десктопе показывается
// только когда цель действительно выбрана. Без сохранённой цели `wordGoal` = 0:
// ни «/ 1000» в шапке, ни полосы. В режим «Слова» человек входит уже с 1000.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, renderHook, act } from '@testing-library/react';
import { getSavedWordGoal, saveWordGoal, useTimerStore } from '../useTimerStore';
import { STORAGE_KEYS } from '../../../../shared/constants/storageKeys';
import { WritingSetup } from '../../components/WritingSetup';
import { useSessionFlow } from '../../hooks/useSessionFlow';

vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'user_q11' }),
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string, n?: number) => (n === undefined ? k : `${k}:${n}`), language: 'ru' }),
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'desktop', setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    setFontFamily: vi.fn(), setFontSize: vi.fn(), setLineHeight: vi.fn(), setEditorWidth: vi.fn(),
    setSilenceMode: vi.fn(), setTypographyEnabled: vi.fn(), setZenModeEnabled: vi.fn(), toggleStreamMode: vi.fn(),
    toggleVisibility: vi.fn(), setTypewriterScrolling: vi.fn(),
    fontFamily: 'Inter', fontSize: 16, lineHeight: 1.6, editorWidth: 60, silenceMode: false,
    typographyEnabled: true, zenModeEnabled: false, streamMode: false, typewriterScrolling: false,
    aiPanelOpen: false, setAiPanelOpen: vi.fn(), quietStats: false, setQuietStats: vi.fn(),
  }),
}));

const UID = 'user_q11';

describe('Q-11: цели по словам нет, пока человек её не выбрал', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useTimerStore.setState({ wordGoal: 0, sessionType: 'free', status: 'idle' } as never);
  });

  it('без сохранённой цели `getSavedWordGoal` даёт 0, а не 1000', () => {
    expect(getSavedWordGoal(UID)).toBe(0);
    localStorage.setItem(STORAGE_KEYS.WORD_GOAL(UID), 'invalid');
    expect(getSavedWordGoal(UID)).toBe(0);
    localStorage.setItem(STORAGE_KEYS.WORD_GOAL(UID), '-10');
    expect(getSavedWordGoal(UID)).toBe(0);
  });

  it('выбранная цель сохраняется и читается как раньше', () => {
    saveWordGoal(750, UID);
    expect(getSavedWordGoal(UID)).toBe(750);
  });

  // Ревью 0.10.2: открытие листа «Слова» цель не сохраняет (иначе после «назад →
  // Поток» полоса 1000 возвращалась навсегда); 1000 — показ в поле.
  it('лист «Слова» показывает 1000, но цель не сохраняет', () => {
    render(
      <WritingSetup
        setupMode="words-config"
        setSetupMode={vi.fn()}
        startCountdown={vi.fn()}
        countdown={null}
        userSessions={[]}
        continueSession={vi.fn()}
      />,
    );
    const input = screen.getByRole('spinbutton', { name: 'writing_words' }) as HTMLInputElement;
    expect(input.value).toBe('1000');
    expect(useTimerStore.getState().wordGoal).toBe(0);
    expect(localStorage.getItem(STORAGE_KEYS.WORD_GOAL(UID))).toBeNull();
  });

  // Ревью 0.10.2: старт «Слов» без цели — с 1000 и на десктопе, и на телефоне
  // (телефонный лист оставлял поле пустым и стартовал без цели и без праздника).
  // Мутация: убрать подстановку в startCountdown — красный.
  it('старт «Слов» без выбранной цели ставит 1000; «Поток» цель не ставит', () => {
    const { result } = renderHook(() => useSessionFlow(vi.fn(), 'idle', 'free' as never, vi.fn(), null, false, false));
    act(() => { result.current.startCountdown('stopwatch' as never); });
    expect(useTimerStore.getState().wordGoal).toBe(0);
    act(() => { result.current.startCountdown('words' as never); });
    expect(useTimerStore.getState().wordGoal).toBe(1000);
  });

  it('старт «Слов» с выбранной целью её не трогает', () => {
    useTimerStore.setState({ wordGoal: 300 } as never);
    const { result } = renderHook(() => useSessionFlow(vi.fn(), 'idle', 'free' as never, vi.fn(), null, false, false));
    act(() => { result.current.startCountdown('words' as never); });
    expect(useTimerStore.getState().wordGoal).toBe(300);
  });
});
