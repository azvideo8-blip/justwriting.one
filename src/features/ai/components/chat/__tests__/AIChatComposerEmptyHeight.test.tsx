// CI 0.9.42 (SA-4): пустой композер на телефоне вырастал до 160 px — высота
// считалась по scrollHeight на монтировании, пока поле ещё не получило ширину
// (подсказка переносилась по буквам), и больше не пересчитывалась.
// Мутация: убрать ветку «пустое поле — одна строка» → первый тест красный.
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AIChatComposer, type AIChatComposerProps } from '../AIChatComposer';
import { renderWithProviders } from '../../../../../test/utils/render';

function render(inputText: string) {
  const inputRef = createRef<HTMLTextAreaElement>();
  const spy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(400);
  renderWithProviders(<AIChatComposer {...({
    isMobile: true, inputText, setInputText: vi.fn(), inputRef, isLoading: false, onStop: vi.fn(), onSend: vi.fn(),
    pendingAttachments: [], removePendingAttachment: vi.fn(), onPasteAsNote: vi.fn(), onAnalyzeNote: vi.fn(),
    onRelateNote: vi.fn(), attachMenuOpen: false, setAttachMenuOpen: vi.fn(), attachMenuRef: { current: null },
    fileInputRef: { current: null }, onFileUpload: vi.fn(), onOpenDocPicker: vi.fn(), dailyLimitRemaining: 28,
    dailyLimitTotal: 60, quotaUnknown: false, reasoningRemaining: 4, reasoningLimit: 5, reasoning: false,
    maxInputChars: 10000, personaName: 'Группа психологов', crisisActive: false, dismissCrisis: vi.fn(),
  } as unknown as AIChatComposerProps)} />);
  spy.mockRestore();
  return inputRef.current!;
}

describe('высота композера', () => {
  it('пустое поле — одна строка, даже если замер на монтировании дал огромную высоту', () => {
    expect(render('').style.height).toBe('');
  });

  it('с текстом — по содержимому, не выше 160 px', () => {
    expect(render('строка').style.height).toBe('160px');
  });
});
