// DC-A2: общее примитив-меню. Клавиатура, возврат фокуса по Esc, клик снаружи.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React, { useState } from 'react';
import { Menu, type MenuAnchor, type MenuEntry } from '../Menu';

const onSelect = vi.fn();
const onClose = vi.fn();
const MENU_LABEL = 'Действия с заметкой';

function Harness({
  entries,
  anchor,
}: {
  entries: MenuEntry[];
  anchor?: MenuAnchor;
}) {
  const [open, setOpen] = useState(true);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [resolved, setResolved] = React.useState<MenuAnchor | null>(anchor ?? null);

  // Якорь по триггеру можно вычислить только после его монтирования.
  React.useEffect(() => {
    if (anchor || !triggerRef.current) return;
    const el = triggerRef.current;
    setResolved({ kind: 'trigger', rect: el.getBoundingClientRect(), trigger: el });
  }, [anchor]);

  const close = () => {
    setOpen(false);
    onClose();
  };

  return (
    <div>
      <button ref={triggerRef}>trigger</button>
      {open && resolved && <Menu entries={entries} anchor={resolved} onClose={close} label={MENU_LABEL} />}
    </div>
  );
}

const items: MenuEntry[] = [
  { kind: 'item', key: 'open', label: 'Открыть', onSelect },
  { kind: 'separator', key: 'sep' },
  { kind: 'heading', key: 'label-h', label: 'Метка' },
  { kind: 'radio', key: 'r1', label: 'Важное', checked: true, onSelect },
  { kind: 'radio', key: 'r2', label: 'Черновик', checked: false, onSelect },
  { kind: 'item', key: 'del', label: 'Удалить', destructive: true, onSelect },
];

beforeEach(() => {
  onSelect.mockClear();
  onClose.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DC-A2: Menu', () => {
  it('открывается с фокусом на первом пункте, ↑/↓ и Home/End ходят по пунктам', () => {
    render(<Harness entries={items} />);
    const first = screen.getByRole('menuitem', { name: 'Открыть' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemradio', { name: 'Важное' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'Важное' }), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemradio', { name: 'Черновик' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: 'Черновик' }), { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Удалить' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Удалить' }), { key: 'ArrowDown' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'Home' });
    expect(first).toHaveFocus();
  });

  it('выбор пункта закрывает меню и дёргает обработчик', () => {
    render(<Harness entries={items} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Открыть' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Esc закрывает и возвращает фокус триггеру', () => {
    render(<Harness entries={items} />);
    const trigger = screen.getByRole('button', { name: 'trigger' });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Открыть' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
  });

  it('клик снаружи закрывает, клик внутри — нет', () => {
    render(<Harness entries={items} />);
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Открыть' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('пункт «Удалить» помечен опасным, радиогруппа — ролями и состоянием', () => {
    render(<Harness entries={items} />);
    expect(screen.getByRole('menu', { name: 'Действия с заметкой' })).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(screen.getByText('Метка')).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Важное' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Черновик' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('menuitem', { name: 'Удалить' }).className).toContain('text-accent-danger');
  });

  it('открытие по точке (контекстное меню) не требует триггера', () => {
    render(<Harness entries={items} anchor={{ kind: 'point', x: 120, y: 80 }} />);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Открыть' })).toHaveFocus();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// G-6 (R3-033, R3-034): прокрутка внутри меню, Tab, возврат фокуса, группа меток.
describe('G-6: Menu — прокрутка, Tab, фокус, группа', () => {
  // Меню с 4+ метками на низком экране само прокручивается (overflow-y-auto).
  // Слушатель на window с capture ловил и эту прокрутку — меню закрывалось
  // под пальцем, и до нижних пунктов было не добраться.
  it('прокрутка внутри меню его не закрывает, прокрутка страницы — закрывает', () => {
    render(<Harness entries={items} />);
    fireEvent.scroll(screen.getByRole('menu'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.scroll(document);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Раньше Tab уходил на страницу за открытым меню, а меню оставалось висеть.
  it('Tab закрывает меню и возвращает фокус триггеру', () => {
    render(<Harness entries={items} />);
    const trigger = screen.getByRole('button', { name: 'trigger' });
    const notPrevented = fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Открыть' }), { key: 'Tab' });
    expect(notPrevented).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('выбор пункта возвращает фокус триггеру, а не роняет его в body', () => {
    render(<Harness entries={items} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Открыть' }));
    expect(screen.getByRole('button', { name: 'trigger' })).toHaveFocus();
  });

  // У контекстного меню триггера нет: фокус возвращается туда, где он был.
  it('меню по точке возвращает фокус элементу, с которого его открыли', () => {
    function PointHarness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>row</button>
          {open && (
            <Menu entries={items} anchor={{ kind: 'point', x: 10, y: 10 }} onClose={() => setOpen(false)} label={MENU_LABEL} />
          )}
        </div>
      );
    }
    render(<PointHarness />);
    const row = screen.getByRole('button', { name: 'row' });
    row.focus();
    fireEvent.click(row);
    expect(screen.getByRole('menuitem', { name: 'Открыть' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Открыть' }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(row).toHaveFocus();
  });

  // В jsdom вёрстки нет, поэтому это храповик по классу. Сама ошибка видна
  // только в браузере: без flex-col меню растягивалось на сумму ширин пунктов.
  it('пункты стоят столбцом: ширина меню — самый длинный пункт, а не их сумма', () => {
    render(<Harness entries={items} />);
    expect(screen.getByRole('menu').className).toContain('flex-col');
    expect(screen.getByRole('group').className).toContain('flex-col');
  });

  // Заголовок группы — текст: 40% давало 2.5–3.7:1 при пороге 4.5:1.
  it('заголовок группы не приглушён ниже читаемого', () => {
    render(<Harness entries={items} />);
    expect(screen.getByText('Метка').className).toContain('text-text-main/70');
  });

  // Скринридер объявлял «радиокнопка 1 из 2» без слова «Метка».
  it('метки — группа с именем из заголовка', () => {
    render(<Harness entries={items} />);
    const group = screen.getByRole('group', { name: 'Метка' });
    expect(within(group).getAllByRole('menuitemradio')).toHaveLength(2);
    expect(within(group).queryByRole('menuitem')).toBeNull();
  });
});
