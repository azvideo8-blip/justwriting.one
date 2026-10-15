// MF-7: под композером на телефоне была пустая полоса — высота нижней панели
// считалась дважды (main уже `pb-safe-nav`). Вместо «0/10 000» знаков нужна
// одна тихая строка «Осталось N запросов».
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { AIChatComposer, type AIChatComposerProps } from '../AIChatComposer';
import { renderWithProviders } from '../../../../../test/utils/render';

function props(over: Partial<AIChatComposerProps> = {}): AIChatComposerProps {
  return {
    isMobile: true,
    inputText: '',
    setInputText: vi.fn(),
    inputRef: { current: null },
    isLoading: false,
    onStop: vi.fn(),
    onSend: vi.fn(),
    pendingAttachments: [],
    removePendingAttachment: vi.fn(),
    onPasteAsNote: vi.fn(),
    onAnalyzeNote: vi.fn(),
    onRelateNote: vi.fn(),
    attachMenuOpen: false,
    setAttachMenuOpen: vi.fn(),
    attachMenuRef: { current: null },
    fileInputRef: { current: null },
    onFileUpload: vi.fn(),
    onOpenDocPicker: vi.fn(),
    dailyLimitRemaining: 28,
    dailyLimitTotal: 60,
    quotaUnknown: false,
    reasoningRemaining: 4,
    reasoningLimit: 5,
    reasoning: false,
    maxInputChars: 10000,
    personaName: 'Группа психологов',
    crisisActive: false,
    dismissCrisis: vi.fn(),
    ...over,
  } as unknown as AIChatComposerProps;
}

function composerRoot(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('div.relative.z-10.shrink-0')!;
}

describe('MF-7: quiet mobile composer', () => {
  it('no keyboard → padding has no nav height (main already pads it)', () => {
    const { container } = renderWithProviders(<AIChatComposer {...props()} />);
    const pb = composerRoot(container).style.paddingBottom;
    expect(pb).not.toContain('--bottom-nav-height');
    expect(pb).toBe('8px');
  });

  it('28 requests left → one quiet line with 28; reasoning on adds its own count', () => {
    const { unmount } = renderWithProviders(<AIChatComposer {...props()} />);
    expect(screen.getByText('Осталось 28 запросов')).toBeInTheDocument();
    unmount();
    renderWithProviders(<AIChatComposer {...props({ reasoning: true })} />);
    expect(screen.getByText(/Осталось 28 запросов · 4 с рассуждением/)).toBeInTheDocument();
  });

  it('empty input → no «0/10 000» character counter; past 90 % it shows', () => {
    const { unmount } = renderWithProviders(<AIChatComposer {...props()} />);
    expect(screen.queryByText(/^0\/10/)).toBeNull();
    unmount();
    renderWithProviders(<AIChatComposer {...props({ inputText: 'я'.repeat(9500) })} />);
    expect(screen.getByText(/9.?500\/10/)).toBeInTheDocument();
  });

  it('desktop keeps the character counter', () => {
    renderWithProviders(<AIChatComposer {...props({ isMobile: false })} />);
    expect(screen.getByText(/^0\/10/)).toBeInTheDocument();
  });
});
