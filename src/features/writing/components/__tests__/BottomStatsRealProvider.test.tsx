import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BottomStats } from '../BottomStats';
import { WritingSettingsProvider } from '../../../../core/settings/WritingSettingsContext';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));

vi.mock('../../store/useContentStore', () => ({
  useContentStore: (sel: (s: unknown) => unknown) =>
    sel({ wordCount: 1234, wpm: 32, content: 'x', setContent: vi.fn(), getState: () => ({ content: 'x', setContent: vi.fn() }) }),
  getState: () => ({ content: 'x', setContent: vi.fn() }),
}));

vi.mock('../../store/useTimerStore', () => ({
  useTimerStore: (sel: (s: unknown) => unknown) =>
    sel({
      status: 'writing', seconds: 120, wordGoal: 0, timerDuration: 1800,
      sessionStartWords: 0, sessionStartSeconds: 0,
      setWordGoal: vi.fn(), setTimerDuration: vi.fn(),
      getState: () => ({ status: 'writing' }),
    }),
  getState: () => ({ status: 'writing' }),
}));

vi.mock('../../hooks/useGuardedSpeechInput', () => ({
  useGuardedSpeechInput: () => ({ isListening: false, toggleListening: vi.fn(), hasSupport: false }),
}));

vi.mock('../GoalPopup', () => ({ GoalPopup: () => null }));

// R4-007: прежние тесты BottomStats объявляли effectiveHeaderVisibility внутри
// vi.mock — реальная выводка в WritingSettingsContext не проверялась никем:
// мутация контекста оставалась зелёной. Здесь рендер под настоящим провайдером,
// quietStats приходит через его же localStorage-ключ.
describe('BottomStats under the real WritingSettingsProvider (R4-007)', () => {
  it('quietStats on: the real derivation hides every counter', () => {
    localStorage.setItem('v1_quietStats', 'true');
    render(
      <WritingSettingsProvider>
        <BottomStats onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />
      </WritingSettingsProvider>
    );
    expect(screen.queryByText('header_totalWords')).not.toBeInTheDocument();
    expect(screen.queryByText('header_wpm')).not.toBeInTheDocument();
    expect(screen.queryByText('1234')).not.toBeInTheDocument();
  });

  it('quietStats off: the real derivation shows the counters', () => {
    localStorage.setItem('v1_quietStats', 'false');
    render(
      <WritingSettingsProvider>
        <BottomStats onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />
      </WritingSettingsProvider>
    );
    expect(screen.getByText('1234')).toBeInTheDocument();
  });
});
