// D-2: подтверждение в листе ввода подписывалось «Удалить» — `okLabel` из
// вызова `prompt()` компонент диалога не читал вовсе и попадал на ветку
// `confirmLabel`, где дефолт — `finish_discard`. Переименование заметки из
// карточки сетки поэтому предлагало сохранить новый заголовок кнопкой «Удалить».
import { describe, it, expect } from 'vitest';
import { screen, act } from '@testing-library/react';
import { renderWithProviders } from '../../../test/utils/render';
import { ConfirmDialogRenderer, useDialogStore } from '../ConfirmDialog';

const store = () => useDialogStore.getState();

function mount() {
  renderWithProviders(<ConfirmDialogRenderer />);
}

describe('D-2', () => {
  it('лист ввода: подтверждение — «Сохранить», а не «Удалить»', () => {
    mount();
    let pending: Promise<string | null> = Promise.resolve(null);
    act(() => {
      pending = store().openPrompt({ title: 'Новое название' });
    });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Сохранить');
    expect(dialog).not.toHaveTextContent('Удалить');
    act(() => {
      store().handleCancel();
    });
    return expect(pending).resolves.toBeNull();
  });

  it('okLabel, переданный в prompt, доходит до кнопки', () => {
    mount();
    act(() => {
      void store().openPrompt({ title: 'Новое название', okLabel: 'Переименовать' });
    });
    expect(screen.getByRole('dialog')).toHaveTextContent('Переименовать');
  });

  it('подпись из прежнего подтверждения не остаётся в листе ввода', () => {
    mount();
    act(() => {
      void store().openConfirm({ title: 'Удалить заметку?', confirmLabel: 'Удалить заметку' });
    });
    act(() => {
      store().handleCancel();
    });
    act(() => {
      void store().openPrompt({ title: 'Новое название' });
    });
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Удалить');
  });

  it('подтверждение без своей подписи остаётся на «Удалить» — поведение правкой не задето', () => {
    mount();
    act(() => {
      void store().openConfirm({ title: 'Удалить заметку?' });
    });
    expect(screen.getByRole('dialog')).toHaveTextContent('Удалить');
  });
});
