import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '../shared/i18n';
import { ToastProvider } from '../shared/components/Toast';
import { MobileNoteActionsSheet } from '../app/components/MobileNoteActionsSheet';

// MC-9: «Удалить заметку» — последний пункт и отделён отступом, а «Открыть»
// не предлагается там, где заметка уже открыта (лист из читалки MP-1).

const NOTE_TITLE = 'Тихий вечер';

const session = {
  id: 'doc-1',
  title: NOTE_TITLE,
  labelId: 'l-1',
  _isLocal: true,
  _hasCloudCopy: false,
};

function renderSheet(fromReader: boolean) {
  render(
    <LanguageProvider>
      <ToastProvider>
        <MobileNoteActionsSheet
          isOpen
          onClose={vi.fn()}
          session={session}
          userId='user_1'
          labels={[{ id: 'l-1', name: 'Дневник', color: '#88aaff' }]}
          onOpen={vi.fn()}
          onRename={vi.fn()}
          onAddTag={vi.fn()}
          onDelete={vi.fn()}
          onLabelChange={vi.fn()}
          onStorageChange={vi.fn()}
          fromReader={fromReader}
        />
      </ToastProvider>
    </LanguageProvider>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Действия с заметкой' });
  return { dialog, list: within(dialog).getByTestId('note-actions-list') };
}

describe('MC-9: порядок пунктов листа действий', () => {
  it('лист из сетки: «Открыть» есть, удаление — последний блок после отступа', () => {
    const { dialog, list } = renderSheet(false);

    expect(within(dialog).getByRole('button', { name: /Открыть/ })).toBeInTheDocument();

    const danger = within(dialog).getByTestId('note-actions-danger');
    expect(within(danger).getByRole('button', { name: /Удалить заметку/ })).toBeInTheDocument();
    expect(danger.className.split(' ').some(c => c.startsWith('mt-')), 'нет отступа перед удалением').toBe(true);
    expect(list.lastElementChild).toBe(danger);
  });

  it('лист из читалки: пункта «Открыть» нет', () => {
    const { dialog } = renderSheet(true);
    expect(within(dialog).queryByRole('button', { name: /Открыть/ })).toBeNull();
    const danger = within(dialog).getByTestId('note-actions-danger');
    expect(within(danger).getByRole('button', { name: /Удалить заметку/ })).toBeInTheDocument();
  });
});
