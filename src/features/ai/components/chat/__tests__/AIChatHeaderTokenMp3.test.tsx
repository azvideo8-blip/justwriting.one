// MP-3: токен персоны в мобильной шапке — монограмма + имя, роль в нём не
// участвует. Роль остаётся в листе персон (MR-3), где у строки есть вторая
// строка-описание. Десктопная шапка не меняется.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIChatHeader, type AIChatHeaderProps } from '../AIChatHeader';

vi.mock('../../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'ru' }),
}));

const visual = { color: '#A583E8', mono: 'Гп' };
const personas = [{ id: 'group_psychology', name: 'Группа психологов', emoji: '🙂', isPreset: true }];

function base(isMobile: boolean, extra: Partial<AIChatHeaderProps> = {}): AIChatHeaderProps {
  return {
    isMobile,
    headerVisual: visual,
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
    allPersonas: personas,
    openPersonaDetail: vi.fn(),
    onCreatePersona: vi.fn(),
    onOpenDialogues: vi.fn(),
    onNewDialogue: vi.fn(),
    ...extra,
  } as AIChatHeaderProps;
}

describe('MP-3: токен персоны на телефоне', () => {
  it('в токене только имя — роли рядом нет', () => {
    render(<AIChatHeader {...base(true)} />);
    const token = screen.getByRole('button', { name: /Группа психологов/ });
    expect(token.textContent).toContain('Группа психологов');
    expect(token.textContent, 'в токене осталась роль').not.toContain('многогранная перспектива');
  });

  it('роль живёт в листе персон, который открывается по токену', () => {
    render(<AIChatHeader {...base(true)} />);
    fireEvent.click(screen.getByRole('button', { name: /Группа психологов/ }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain('Группа психологов');
    expect(sheet.textContent).toContain('многогранная перспектива');
  });

  it('десктопная шапка по-прежнему показывает роль', () => {
    render(<AIChatHeader {...base(false)} />);
    expect(screen.getByText('многогранная перспектива')).toBeInTheDocument();
  });
});
