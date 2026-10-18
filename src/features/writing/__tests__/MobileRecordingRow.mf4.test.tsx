// MF-4: на телефоне запись идёт в самой панели письма, а не в карточке над ней
// (карточка ужимала предупреждение о запросе в столбик в одно слово).
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key, tp: (key: string) => key }),
}));
vi.mock('../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    fontFamily: 'Inter', fontSize: 18, isZenActive: false, zenModeEnabled: false,
    streamMode: false, toggleStreamMode: vi.fn(), autoHideCursor: false,
    aiPanelOpen: false, setAiPanelOpen: vi.fn(),
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('../store/useContentStore', () => ({
  useContentStore: (cb: (s: unknown) => unknown) => cb({
    content: 'Начало. ', setContent: vi.fn(), title: 'Запись', setTitle: vi.fn(),
    wordCount: 2, wpm: 30, wpmHistory: [],
  }),
}));
vi.mock('../store/useTimerStore', () => ({
  useTimerStore: (cb: (s: unknown) => unknown) => cb({
    status: 'writing', seconds: 40, timerDuration: 0, wordGoal: 0,
    sessionStartSeconds: 0, sessionStartWords: 0,
  }),
}));
// Диктовка идёт: панель записи монтируется.
vi.mock('../hooks/useDictation', () => ({
  useDictation: () => ({
    isListening: true, hasSupport: true, phase: 'recording', isVaultActive: false,
    aiNoticeRemaining: 30, toggle: vi.fn(), stop: vi.fn(), cancel: vi.fn(),
    liveText: 'Проверка панели диктовки', interimText: '', level: 0.4,
    levels: [0.2, 0.4], levelFailed: false, seconds: 12,
  }),
}));

const { MobileWriteScreen } = await import('../components/MobileWriteScreen');
const { DictationChrome } = await import('../components/DictationBar');

describe('MF-4: recording happens inside the toolbar', () => {
  // U-18 (2026-10-18): вид как у полосы диктовки десктопа, но «×» слева (ревью 0.10.1):
  // справа в покое — «Сохранить», и отмена на её месте выбрасывала продиктованное.
  it('mobile: the toolbar row turns into × · wave/words · timer · Stop, with no card above', () => {
    render(<MobileWriteScreen onPlay={vi.fn()} onStop={vi.fn()} />);
    expect(document.querySelector('[data-dictation-bar]'), 'на телефоне осталась карточка записи').toBeNull();
    const toolbar = document.querySelector('[data-write-toolbar]')!;
    const row = toolbar.querySelector('[data-dictation-row]')!;
    expect(row, 'панель не перешла в строку записи').not.toBeNull();
    const buttons = Array.from(toolbar.querySelectorAll('button')).map(b => b.getAttribute('aria-label'));
    expect(buttons).toEqual(['voice_cancel', 'voice_stop_dictation']);
    expect(row.querySelector('[data-dictation-timer]')?.textContent).toBe('0:12');
    expect(screen.queryByText(/voice_ai_request_notice/), 'в строке записи осталось предупреждение о запросе').toBeNull();
    // Мягкий «Стоп», как на десктопе: подложка danger/10, а не сплошной красный круг.
    expect(screen.getByRole('button', { name: 'voice_stop_dictation' }).className).toContain('bg-accent-danger/10');
  });

  it('desktop still renders the card', () => {
    render(<DictationChrome />);
    expect(document.querySelector('[data-dictation-bar]')).not.toBeNull();
  });
});
