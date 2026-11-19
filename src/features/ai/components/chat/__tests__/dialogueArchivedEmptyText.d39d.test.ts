// d39d: пустой архив диалогов на телефоне назван «Нет активных диалогов».
// Настоящий MobileDialogueListSheet; десктопный AIChatSidebar для того же
// состояния показывает «Нет архивных диалогов».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/shared/utils/touchPointer', () => ({ hasOnlyTouchPointer: () => true }));

import { MobileDialogueListSheet } from '@/features/ai/components/chat/MobileDialogueListSheet';
import { LanguageProvider } from '@/shared/i18n';

function renderSheet(showArchived: boolean) {
  return render(
    h(LanguageProvider, null,
      h(MobileDialogueListSheet, {
        open: true,
        onClose: vi.fn(),
        dialogues: [],
        archivedDialogues: [],
        activeDialogueId: null,
        showArchived,
        setShowArchived: vi.fn(),
        onSelectDialogue: vi.fn(),
        onRename: vi.fn(),
        onArchive: vi.fn(),
        onUnarchive: vi.fn(),
        onDelete: vi.fn(),
        loading: false,
        loadError: false,
      })),
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('d39d: пустой архив диалогов назван своим текстом', () => {
  it('showArchived=true и архив пуст — «Нет архивных диалогов», не «активных»', () => {
    renderSheet(true);
    expect(screen.queryByText('Нет активных диалогов'), 'пустой архив назван активными диалогами').toBeNull();
    expect(screen.getByText('Нет архивных диалогов')).toBeTruthy();
  });

  it('КОНТРОЛЬ: showArchived=false и активных нет — «Нет активных диалогов»', () => {
    renderSheet(false);
    expect(screen.getByText('Нет активных диалогов')).toBeTruthy();
  });
});
