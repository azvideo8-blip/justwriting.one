// SA-2: при отказе сервера прочитать лимиты композер не должен показывать
// прошлое число как текущее — и не должен блокировать отправку по нему.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { AIChatComposer, type AIChatComposerProps } from '../chat/AIChatComposer';
import { useAiLimitStore } from '../../store/useAiLimitStore';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'ru' }),
}));

function props(over: Partial<AIChatComposerProps> = {}): AIChatComposerProps {
  return {
    inputText: 'текст',
    setInputText: () => {},
    inputRef: createRef<HTMLTextAreaElement>(),
    isLoading: false,
    onStop: () => {},
    onSend: () => {},
    pendingAttachments: [],
    removePendingAttachment: () => {},
    onPasteAsNote: () => {},
    attachMenuOpen: false,
    setAttachMenuOpen: () => {},
    attachMenuRef: createRef<HTMLDivElement>(),
    fileInputRef: createRef<HTMLInputElement>(),
    onFileUpload: () => {},
    onOpenDocPicker: () => {},
    dailyLimitRemaining: 12,
    dailyLimitTotal: 30,
    maxInputChars: 8000,
    personaName: 'Марк',
    crisisActive: false,
    dismissCrisis: () => {},
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAiLimitStore.setState({ limitUnknown: false, reconciled: true });
});

describe('SA-2: композер при «данные о лимите недоступны»', () => {
  it('вместо чисел показывает метку', () => {
    const { container } = render(<AIChatComposer {...props({ quotaUnknown: true })} />);
    expect(screen.getByText('ai_quota_unavailable')).toBeInTheDocument();
    expect(container.textContent).not.toContain('12/30');
    expect(container.textContent).not.toContain('5/5');
  });

  it('не блокирует отправку по устаревшему нулю', () => {
    render(<AIChatComposer {...props({ quotaUnknown: true, dailyLimitRemaining: 0 })} />);
    expect(screen.getByRole('button', { name: /ai_send/i })).toBeEnabled();
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(screen.queryByText('ai_quota_exhausted')).not.toBeInTheDocument();
  });

  it('без отметки числа на месте и исчерпанный лимит по-прежнему блокирует', () => {
    const { container } = render(<AIChatComposer {...props({ dailyLimitRemaining: 0 })} />);
    expect(container.textContent).toContain('0/30');
    expect(screen.queryByText('ai_quota_unavailable')).not.toBeInTheDocument();
    expect(screen.getByText('ai_quota_exhausted')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
