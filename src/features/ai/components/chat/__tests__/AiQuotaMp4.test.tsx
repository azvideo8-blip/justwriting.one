// MP-4: на телефоне полоса лимита не живёт между капсулой композера и вкладками.
// Числа уезжают в лист «⋯» шапки диалога одной строкой, а под композером
// остаётся только предупреждение: ≤ 3 сообщений или лимит выбран.
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../../test/utils/render';
import { AIChatComposer, type AIChatComposerProps } from '../AIChatComposer';
import { AIChatHeader, type AIChatHeaderProps } from '../AIChatHeader';

const composerBase: AIChatComposerProps = {
  isMobile: true,
  keyboardHeight: 0,
  inputText: 'Текст запроса',
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
  dailyLimitRemaining: 59,
  dailyLimitTotal: 60,
  reasoningRemaining: 5,
  reasoningLimit: 5,
  reasoning: false,
  maxInputChars: 1000,
  crisisActive: false,
  dismissCrisis: vi.fn(),
};

const quota = { chatRemaining: 59, chatTotal: 60, reasoningRemaining: 5, reasoningTotal: 5 };

const headerBase = {
  isMobile: true,
  headerVisual: { color: '#A583E8', mono: 'Гп' },
  activePersonaName: 'Группа психологов',
  activeRole: 'многогранная перспектива',
  dialogueTitle: 'Разговор про глину',
  hasActiveDialogue: true,
  activeDialogueId: 'd1',
  onOpenMemory: vi.fn(),
  responseLength: 'standard',
  reasoning: false,
  onSetResponseLength: vi.fn(),
  onToggleReasoning: vi.fn(),
  onExport: vi.fn(),
  onArchive: vi.fn(),
  onDelete: vi.fn(),
  onRename: vi.fn(),
  selectedPersonaId: 'group_psychology',
  setSelectedPersonaId: vi.fn(),
  allPersonas: [{ id: 'group_psychology', name: 'Группа психологов', emoji: '🙂', isPreset: true }],
  openPersonaDetail: vi.fn(),
  onCreatePersona: vi.fn(),
  onOpenDialogues: vi.fn(),
  onNewDialogue: vi.fn(),
  quota,
} as unknown as AIChatHeaderProps;

describe('MP-4: лимит на телефоне', () => {
  it('при 59/60 под композером нет ни полосы, ни чисел', () => {
    renderWithProviders(<AIChatComposer {...composerBase} />);
    expect(screen.queryByText(/чат/), 'под композером осталась полоса лимита').toBeNull();
    expect(screen.queryByText('59/60')).toBeNull();
  });

  it('при 2/60 предупреждение показано', () => {
    renderWithProviders(<AIChatComposer {...composerBase} dailyLimitRemaining={2} />);
    expect(screen.getByText('2/60'), 'предупреждения о лимите нет').toBeInTheDocument();
  });

  it('при 0/60 предупреждение показано', () => {
    renderWithProviders(<AIChatComposer {...composerBase} dailyLimitRemaining={0} />);
    expect(screen.getByText(/0\/60/)).toBeInTheDocument();
  });

  it('десктопная полоса не изменилась', () => {
    renderWithProviders(<AIChatComposer {...composerBase} isMobile={false} />);
    expect(screen.getByText(/чат/)).toBeInTheDocument();
    expect(screen.getByText('59/60')).toBeInTheDocument();
    expect(screen.getByText(/рассуждения/)).toBeInTheDocument();
  });

  it('лист «⋯» шапки показывает остатки одной строкой', () => {
    renderWithProviders(<AIChatHeader {...headerBase} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ещё' }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain('Осталось сегодня');
    expect(sheet.textContent).toContain('59/60');
    expect(sheet.textContent).toContain('5/5');
  });
});
