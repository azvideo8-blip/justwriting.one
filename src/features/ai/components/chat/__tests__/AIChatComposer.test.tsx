import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { AIChatComposer, type AIChatComposerProps } from '../AIChatComposer';
import { renderWithProviders } from '../../../../../test/utils/render';

const defaultProps: AIChatComposerProps = {
  inputText: 'Hello',
  setInputText: vi.fn(),
  inputRef: { current: null },
  isLoading: false,
  onStop: vi.fn(),
  onSend: vi.fn(),
  pendingAttachments: [],
  removePendingAttachment: vi.fn(),
  onPasteAsNote: vi.fn(),
  attachMenuOpen: false,
  setAttachMenuOpen: vi.fn(),
  attachMenuRef: { current: null },
  fileInputRef: { current: null },
  onFileUpload: vi.fn(),
  onOpenDocPicker: vi.fn(),
  dailyLimitRemaining: 10,
  dailyLimitTotal: 30,
  reasoningRemaining: 5,
  reasoningLimit: 5,
  reasoning: false,
  maxInputChars: 1000,
  personaName: 'Writer',
  crisisActive: false,
  dismissCrisis: vi.fn(),
};

describe('AIChatComposer quota indicator', () => {
  it('disables send button and displays reset text when dailyLimitRemaining is 0', () => {
    renderWithProviders(
      <AIChatComposer
        {...defaultProps}
        dailyLimitRemaining={0}
      />
    );

    const sendButton = screen.getByRole('button', { name: /отправить|send/i });
    expect(sendButton).toBeDisabled();

    expect(screen.getByText(/сброс в 00:00|resets at 00:00/i)).toBeInTheDocument();
  });

  it('applies warning class when dailyLimitRemaining is 2', () => {
    const { container } = renderWithProviders(
      <AIChatComposer
        {...defaultProps}
        dailyLimitRemaining={2}
      />
    );

    const warningElement = container.querySelector('.text-accent-warning');
    expect(warningElement).toBeInTheDocument();
    expect(warningElement?.textContent).toContain('2/30');

    const warningBar = container.querySelector('.bg-accent-warning');
    expect(warningBar).toBeInTheDocument();
  });
});
