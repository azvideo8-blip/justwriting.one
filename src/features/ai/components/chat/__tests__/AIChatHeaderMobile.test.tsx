// MR-1: мобильная шапка чата — «Диалоги» (☰) и «Новый диалог» (+) по 44 px,
// все действия диалога свёрнуты в «⋯». Десктопная ветка не меняется.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AIChatHeader, type AIChatHeaderProps } from '../AIChatHeader';

vi.mock('../../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const visual = { color: '#7aa2ff', mono: 'Н' };
const personas = [{ id: 'p1', name: 'Наставница', emoji: '🙂', isPreset: true }];

function base(isMobile: boolean, extra: Partial<AIChatHeaderProps> = {}): AIChatHeaderProps {
  return {
    isMobile,
    headerVisual: visual,
    activePersonaName: 'Наставница',
    activeRole: 'старший коллега',
    dialogueTitle: 'Разговор с мамой',
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
    selectedPersonaId: 'p1',
    setSelectedPersonaId: vi.fn(),
    allPersonas: personas,
    openPersonaDetail: vi.fn(),
    onCreatePersona: vi.fn(),
    onOpenDialogues: vi.fn(),
    onNewDialogue: vi.fn(),
    ...extra,
  } as AIChatHeaderProps;
}

/** 44 px в Tailwind — w-11/h-11; в jsdom геометрии нет, поэтому проверяется класс. */
function expectHit44(el: HTMLElement) {
  expect(el.className).toContain('w-11');
  expect(el.className).toContain('h-11');
}

describe('MR-1: мобильная AIChatHeader', () => {
  it('на телефоне есть «Диалоги» и «Новый диалог», оба не меньше 44 px', () => {
    render(<AIChatHeader {...base(true)} />);
    const dialogues = screen.getByRole('button', { name: /ai_dialogues_open/ });
    const fresh = screen.getByRole('button', { name: /ai_new_dialogue/ });
    expectHit44(dialogues);
    expectHit44(fresh);
  });

  it('на телефоне действия диалога лежат в «⋯», а не отдельными кнопками', () => {
    render(<AIChatHeader {...base(true)} />);
    expect(screen.getByRole('button', { name: /ai_more/ })).toBeTruthy();
    // Открытый ряд иконок памяти/экспорта/архива/удаления на телефоне не рисуется.
    expect(screen.queryByRole('button', { name: /ai_memory_title/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /ai_download_md/ })).toBeNull();
  });

  it('на десктопе ☰ не появляется, старый набор кнопок остаётся', () => {
    render(<AIChatHeader {...base(false)} />);
    expect(screen.queryByRole('button', { name: /ai_dialogues_open/ })).toBeNull();
    expect(screen.getByRole('button', { name: /ai_memory_title/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /ai_download_md/ })).toBeTruthy();
  });
});
