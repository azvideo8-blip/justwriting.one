import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// MB-5 (F-26): панель диктовки и панель управления — один столбец над нижней
// панелью. Раньше DictationChrome лежал в потоке flex-col, а тулбар — absolute
// поверх него, и от панели записи оставались обрывки: «Остановить» и живые слова
// были закрыты тулбаром и чипом. Геометрию мерит стендовая спека
// e2e/mobile/dictation-panel-above-toolbar.mb5.spec.ts, здесь — контракт
// структуры: у панели и тулбара общий позиционированный родитель, и панель идёт
// первой (значит над тулбаром).

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

describe('MB-5: панель диктовки над панелью инструментов', () => {
  it('у панели записи и тулбара общий позиционированный столбец, панель выше', () => {
    render(<MobileWriteScreen onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);
    const bar = document.querySelector('[data-dictation-bar]');
    const toolbar = document.querySelector('[data-write-toolbar]');
    expect(bar, 'панель записи не отрендерилась').not.toBeNull();
    expect(toolbar, 'тулбар не отрендерился').not.toBeNull();

    const stack = bar!.parentElement!.parentElement!;
    expect(stack, 'панель и тулбар не в одном столбце').toBe(toolbar!.parentElement);
    expect(stack.className).toContain('absolute');
    expect(stack.className).toContain('flex-col');
    // Порядок детей = порядок в столбце: сначала панель, значит она над тулбаром.
    expect(stack.children[0]).toContainElement(bar!.parentElement!);
    expect(stack.children[1]).toBe(toolbar);
    expect(toolbar!.parentElement?.parentElement).not.toBe(document.body);
  });

  it('столбец поднят над нижней панелью, а прижат к её верху координатой bottom', () => {
    render(<MobileWriteScreen onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);
    const stack = document.querySelector('[data-write-toolbar]')!.parentElement!;
    expect(stack.getAttribute('style')).toMatch(/bottom:/);
    expect(stack.getAttribute('style')).toMatch(/--bottom-nav-height/);
  });
});
