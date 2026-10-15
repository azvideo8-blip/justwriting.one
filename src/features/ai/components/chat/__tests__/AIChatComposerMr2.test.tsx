// MR-2: на телефоне композер над нижней панелью и не перекрыт рядом персон.
// Десктопный композер не должен меняться ни классом, ни порядком узлов.
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { AIChatComposer, type AIChatComposerProps } from '../AIChatComposer';
import { renderWithProviders } from '../../../../../test/utils/render';

function base(isMobile: boolean): AIChatComposerProps {
  return {
    isMobile,
    inputText: 'текст',
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
    dailyLimitRemaining: 59,
    dailyLimitTotal: 60,
    quotaUnknown: false,
    reasoningRemaining: 5,
    reasoningLimit: 5,
    reasoning: false,
    maxInputChars: 10000,
    personaName: 'Группа психологов',
    crisisActive: false,
    dismissCrisis: vi.fn(),
  } as unknown as AIChatComposerProps;
}

describe('MR-2: AIChatComposer', () => {
  it('на телефоне кнопка отправки имеет доступное имя и цель касания 44 px', () => {
    renderWithProviders(<AIChatComposer {...base(true)} />);
    const send = screen.getByRole('button', { name: /Отправить/ });
    // 44 px в Tailwind — w-11/h-11; в jsdom геометрии нет, поэтому проверяется класс.
    expect(send.className).toContain('w-11');
    expect(send.className).toContain('h-11');
  });

  it('на десктопе разметка композера не изменилась', () => {
    const { container } = renderWithProviders(<AIChatComposer {...base(false)} />);
    const root = container.querySelector('div.relative.z-10');
    expect(root?.className).toBe('relative z-10 px-6 py-4 border-t border-border-subtle');
    const send = screen.getByRole('button', { name: /Отправить/ });
    expect(send.className).not.toContain('w-11');
  });
});
