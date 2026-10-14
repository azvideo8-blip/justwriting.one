// MR-3: выбор персоны на телефоне — лист из шапки, один контроль вместо двух.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { AIChatHeader, type AIChatHeaderProps } from '../AIChatHeader';
import { renderWithProviders } from '../../../../../test/utils/render';

const personas = [
  { id: 'gp', name: 'Группа психологов', emoji: '🙂', isPreset: true },
  { id: 'cbt', name: 'КПТ-психолог', emoji: '🧠', isPreset: true },
  { id: 'coach', name: 'Коуч', emoji: '🚀', isPreset: true },
];

function base(isMobile: boolean, extra: Partial<AIChatHeaderProps> = {}): AIChatHeaderProps {
  return {
    isMobile,
    headerVisual: { color: '#888', mono: 'Гп' },
    activePersonaName: 'Группа психологов',
    activeRole: 'многогранная перспектива',
    dialogueTitle: 'Заголовок',
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
    selectedPersonaId: 'gp',
    setSelectedPersonaId: vi.fn(),
    allPersonas: personas,
    openPersonaDetail: vi.fn(),
    onCreatePersona: vi.fn(),
    onOpenDialogues: vi.fn(),
    onNewDialogue: vi.fn(),
    ...extra,
  } as unknown as AIChatHeaderProps;
}

describe('MR-3: выбор персоны на телефоне', () => {
  it('в мобильной шапке один контроль персоны — токен', () => {
    renderWithProviders(<AIChatHeader {...base(true)} />);
    expect(screen.getAllByRole('button', { name: /Группа психологов/ })).toHaveLength(1);
    // Второго выпадающего списка «СОБЕСЕДНИК: …» на телефоне нет.
    expect(screen.queryByText(/собеседник/i)).toBeNull();
  });

  it('тап по токену открывает лист: по строке на персону, не меньше 48 px', () => {
    renderWithProviders(<AIChatHeader {...base(true)} />);
    fireEvent.click(screen.getByRole('button', { name: /Группа психологов/ }));
    const sheet = screen.getByRole('dialog');
    for (const p of personas) {
      // Строку ищем внутри листа: токен в шапке носит то же имя.
      const row = within(sheet).getByRole('button', { name: new RegExp(p.name) });
      expect(sheet.contains(row)).toBe(true);
      // 48 px в Tailwind — h-12.
      expect(row.className).toContain('h-12');
    }
    expect(within(sheet).getByRole('button', { name: /Своя персона/ })).toBeTruthy();
  });

  it('выбор персоны вызывает setSelectedPersonaId и закрывает лист', () => {
    const props = base(true);
    renderWithProviders(<AIChatHeader {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Группа психологов/ }));
    fireEvent.click(screen.getByRole('button', { name: /КПТ-психолог/ }));
    expect(props.setSelectedPersonaId).toHaveBeenCalledWith('cbt');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('на десктопе выпадающий список персоны остаётся как был', () => {
    renderWithProviders(<AIChatHeader {...base(false)} />);
    expect(screen.getByRole('button', { name: /Группа психологов/ })).toBeTruthy();
    expect(screen.queryByText(/ai_interlocutor/i) ?? screen.getAllByText(/собеседник/i).length).toBeTruthy();
  });
});
