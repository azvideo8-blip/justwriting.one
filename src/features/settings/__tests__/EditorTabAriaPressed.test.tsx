import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditorTab } from '../components/EditorTab';

const setThemeId = vi.fn();
let currentThemeId = 'amethyst';

vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
    language: 'ru',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('../../../core/theme/ThemeProvider', () => ({
  useTheme: () => ({
    themeId: currentThemeId,
    setThemeId: (id: string) => { currentThemeId = id; setThemeId(id); },
    themes: {
      amethyst: { id: 'amethyst', nameRu: 'Аметистовый', nameEn: 'Amethyst', cssClass: 'theme-amethyst' },
      notion: { id: 'notion', nameRu: 'Тёплый', nameEn: 'Warm', cssClass: 'theme-notion' },
    },
  }),
}));

vi.mock('../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    fontFamily: 'Inter', setFontFamily: vi.fn(),
    fontSize: 16, setFontSize: vi.fn(),
    lineHeight: 1.5, setLineHeight: vi.fn(),
    editorWidth: 72, setEditorWidth: vi.fn(),
    silenceMode: false, setSilenceMode: vi.fn(),
    typographyEnabled: false, setTypographyEnabled: vi.fn(),
    zenModeEnabled: false, setZenModeEnabled: vi.fn(),
    streamMode: false, toggleStreamMode: vi.fn(),
    headerVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    toggleVisibility: vi.fn(),
    typewriterScrolling: false, setTypewriterScrolling: vi.fn(),
    focusModeEnabled: false, setFocusModeEnabled: vi.fn(),
    autoHideCursor: false, setAutoHideCursor: vi.fn(),
  }),
}));

vi.mock('../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'desktop' }),
}));

describe('DC-X2: theme picker exposes its state to assistive tech', () => {
  it('theme button aria-pressed flips on click', () => {
    const { rerender } = render(<EditorTab />);

    const target = screen.getByRole('button', { name: /Тёплый/ });
    expect(target).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(target);
    expect(setThemeId).toHaveBeenCalledWith('notion');

    currentThemeId = 'notion';
    rerender(<EditorTab />);
    expect(screen.getByRole('button', { name: /Тёплый/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Аметистовый/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('visibility toggles carry aria-pressed too', () => {
    render(<EditorTab />);
    expect(screen.getByRole('button', { name: /header_sessionTime/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /header_wpm/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
