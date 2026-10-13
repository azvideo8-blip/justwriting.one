import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ModalShell } from '../ModalShell';

// MB-4 (F-4, F-23): окно внутри `main` не может подняться над нижней панелью —
// у main свой контекст наложения (relative z-10), у BottomNav слой --z-sidebar
// снаружи. Поэтому ModalShell рендерится порталом в document.body.
// Проверяется то, что портал не унёс: разметка над панелью, фокус-трап, Esc
// (вложенные окна — по одному), блокировка прокрутки.

function Shell({ children, onClose, variant = 'modal' }: {
  children?: React.ReactNode;
  onClose: () => void;
  variant?: 'modal' | 'sheet';
}) {
  return (
    <ModalShell open labelId="h" onClose={onClose} variant={variant}>
      <h2 id="h">Title</h2>
      <button type="button" onClick={onClose}>First</button>
      <button type="button">Last</button>
      {children}
    </ModalShell>
  );
}

describe('MB-4: ModalShell через портал', () => {
  beforeEach(() => { cleanup(); document.body.style.overflow = ''; });

  it('содержимое окна — ребёнок document.body, а не React-родителя', () => {
    const { container } = render(
      <div data-testid="parent">
        <Shell onClose={vi.fn()} />
      </div>,
    );
    const dialog = screen.getByRole('dialog');
    const parent = screen.getByTestId('parent');

    expect(parent.contains(dialog), 'окно осталось внутри родителя').toBe(false);
    expect(dialog.closest('[data-testid="parent"]')).toBeNull();
    // Портал кладёт подложку прямым ребёнком body — оттуда она видит всю
    // высоту экрана и слой выше панели.
    const backdrop = dialog.parentElement!;
    expect(backdrop.parentElement).toBe(document.body);
    expect(backdrop.className.split(' ')).toContain('inset-0');
    expect(backdrop.className).toMatch(/\bfixed\b/);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('фокус-трап держится после портала', () => {
    render(<div><Shell onClose={vi.fn()} /></div>);
    const buttons = screen.getAllByRole('button');
    expect(document.activeElement).toBe(buttons[0]);

    // Tab с последней фокусируемой кнопки возвращается в первую, а не уходит в страницу.
    const last = buttons[buttons.length - 1]!;
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);

    // Лист тоже порталуется и тоже держит фокус.
    cleanup();
    render(<div data-testid="parent"><Shell onClose={vi.fn()} variant="sheet" /></div>);
    const sheetDialog = screen.getByRole('dialog');
    expect(sheetDialog.closest('[data-testid="parent"]')).toBeNull();
    expect(sheetDialog.parentElement?.parentElement).toBe(document.body);
    expect(document.activeElement?.closest('[role="dialog"]')).toBe(sheetDialog);
  });

  it('Esc закрывает только верхнее окно', () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    // Как это бывает на деле: сначала лист, поверх него подтверждение — второе
    // окно монтируется позже, и его обработчик лежит на вершине стека.
    const { rerender } = render(<div><Shell onClose={closeOuter}><span /></Shell></div>);
    rerender(<div><Shell onClose={closeOuter}><Shell onClose={closeInner} /></Shell></div>);
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();
  });

  it('прокрутка фона блокируется и возвращается при закрытии', () => {
    document.body.style.overflow = 'auto';
    const { rerender } = render(<div><Shell onClose={vi.fn()} /></div>);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<div><ModalShell open={false} onClose={vi.fn()} labelId="h">empty</ModalShell></div>);
    expect(document.body.style.overflow).toBe('auto');
  });

  it('подложка шлёт onClose, содержимое — нет', () => {
    const onClose = vi.fn();
    render(<div><Shell onClose={onClose} /></div>);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = dialog.parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
