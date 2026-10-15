import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// MB-2 (F-1): на телефоне дзен прячет только статистику. «Сохранить», микрофон и чип
// обязаны оставаться достижимыми одним касанием — иначе сессию нельзя завершить.
const zen = vi.hoisted(() => ({ isZenActive: false }));

vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key, tp: (key: string) => key }),
}));
vi.mock('../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    fontFamily: 'Inter',
    fontSize: 18,
    isZenActive: zen.isZenActive,
    zenModeEnabled: true,
    streamMode: false,
    toggleStreamMode: vi.fn(),
    autoHideCursor: false,
    aiPanelOpen: false,
    setAiPanelOpen: vi.fn(),
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('../store/useContentStore', () => ({
  useContentStore: (cb: (s: unknown) => unknown) => cb({
    content: 'Одна вторая', setContent: vi.fn(), title: 'Заголовок', setTitle: vi.fn(),
    wordCount: 2, wpm: 40, wpmHistory: [{ timestamp: 1, wpm: 40 }],
  }),
}));
vi.mock('../store/useTimerStore', () => ({
  useTimerStore: (cb: (s: unknown) => unknown) => cb({
    status: 'writing', seconds: 30, timerDuration: 0, wordGoal: 0,
    sessionStartSeconds: 0, sessionStartWords: 0,
  }),
}));
// Кнопка микрофона рендерится только когда браузер умеет распознавать речь;
// phase 'idle' — панель диктовки не монтируется (она вне этого теста).
vi.mock('../hooks/useDictation', () => ({
  useDictation: () => ({
    isListening: false, toggle: vi.fn(), hasSupport: true, isVaultActive: false,
    aiNoticeRemaining: null, phase: 'idle',
  }),
}));

const { MobileWriteScreen } = await import('../components/MobileWriteScreen');

describe('MB-2: дзен на телефоне не съедает управление сессией', () => {
  beforeEach(() => { zen.isZenActive = false; });

  it('без дзена: кнопки и статистика на месте', () => {
    render(<MobileWriteScreen onPlay={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'topbar_save' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'voice_start' })).toBeTruthy();
    // MF-3: пауза ушла в лист сессии (тап по чипу), статистика — в чип.
    expect(screen.getByRole('button', { name: 'writing_mode_token' }).textContent).toContain('writing_words_short');
  });

  it('в дзене: «Сохранить», чип и микрофон остаются, слова прячутся', () => {
    zen.isZenActive = true;
    render(<MobileWriteScreen onPlay={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'topbar_save' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'voice_start' })).toBeTruthy();
    const chip = screen.getByRole('button', { name: 'writing_mode_token' });
    expect(chip.textContent).not.toContain('writing_words_short');
    expect(chip.textContent).toMatch(/▶/);
  });

  it('в дзене шапка с названием и статусом сохранения скрыта', () => {
    zen.isZenActive = true;
    render(<MobileWriteScreen onPlay={vi.fn()} onStop={vi.fn()} />);
    expect(screen.queryByLabelText('topbar_title_placeholder')).toBeNull();
  });
});

// Подсказка «двигай мышь» на экране без мыши (F-14): телефон без права на
// мобильный макет получает десктопную раскладку — и эту строку тоже.
describe('MB-2: подсказка дзена по типу указателя', () => {
  const realMatchMedia = window.matchMedia;

  function stubPointer(matches: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches, media: query, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
      }),
    });
  }

  beforeEach(() => { Object.defineProperty(window, 'matchMedia', { writable: true, value: realMatchMedia }); });

  it('pointer: coarse → только палец', async () => {
    stubPointer(true);
    const { hasOnlyTouchPointer } = await import('../../../shared/utils/touchPointer');
    expect(hasOnlyTouchPointer()).toBe(true);
  });

  it('обычный указатель → не «только палец»', async () => {
    stubPointer(false);
    const { hasOnlyTouchPointer } = await import('../../../shared/utils/touchPointer');
    expect(hasOnlyTouchPointer()).toBe(false);
  });

  it('мобильные варианты подсказки не содержат мыши, десктопные — содержат', async () => {
    const { writingTranslations } = await import('../../../shared/i18n/translations/writing');
    const ru = (key: string) => String(writingTranslations[key]?.ru ?? `<нет ключа ${key}>`);
    expect(ru('zen_hint_touch')).not.toMatch(/мыш/);
    expect(ru('zen_hint_silence_touch')).not.toMatch(/мыш/);
    expect(String(writingTranslations['zen_hint_touch']?.en ?? '')).toMatch(/Touch/i);
    // Десктопные строки не тронуты.
    expect(ru('zen_hint')).toMatch(/мыш/);
  });

  it('MR-7: в дзене остаётся одна строка шапки, поля названия и подсказки свайпа нет', () => {
    zen.isZenActive = true;
    const { container } = render(<MobileWriteScreen onPlay={vi.fn()} onStop={vi.fn()} />);
    // Одна строка 30 px с временем и словами.
    const row = screen.getByTestId('zen-header-row');
    expect(row.className).toContain('h-[30px]');
    expect(row?.textContent).toContain('writing_words');
    // Поле названия в дзене скрыто.
    expect(screen.queryByRole('textbox', { name: /topbar_title_placeholder/ })).toBeNull();
    // Подсказка «смахни вниз» убрана совсем.
    expect(container.textContent).not.toContain('swipe_down_hint');
  });

  it('MR-7: без дзена подсказки свайпа тоже нет (жест остался)', () => {
    zen.isZenActive = false;
    const { container } = render(<MobileWriteScreen onPlay={vi.fn()} onStop={vi.fn()} />);
    expect(container.textContent).not.toContain('swipe_down_hint');
    expect(screen.queryByTestId('zen-header-row')).toBeNull();
  });

});
