// D-4: в трёх тёмных темах включённый переключатель в панели редактора был невидим —
// ручка `bg-white` лежала на дорожке `bg-text-main`. В системе два переключателя:
// общий `Toggle` (сделан на токенах) и самописная разметка в `ToggleRow`. Строка
// обязана использовать общий.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ToggleRow } from '../SettingsHelpers';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'desktop', setLayoutMode: vi.fn() }),
}));

describe('D-4', () => {
  it('строка с опцией рисует общий переключатель, а не свою разметку', () => {
    render(<ToggleRow label="Дзен-режим" hint="Скрывает интерфейс" value={true} onChange={vi.fn()} />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).toHaveAttribute('aria-label', 'Дзен-режим');
  });

  it('в строке нет белого цвета мимо токенов', () => {
    const { container } = render(<ToggleRow label="Дзен-режим" hint="Скрывает интерфейс" value={true} onChange={vi.fn()} />);
    expect(container.innerHTML).not.toMatch(/bg-white|text-white/);
  });

  it('дорожка и ручка включённого — на токенах: ручка светлая на тёмной дорожке', () => {
    const { container } = render(<ToggleRow label="Вкл" value onChange={vi.fn()} />);
    const sw = within(container).getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw.querySelector('span')?.className).toContain('bg-text-main');
    expect(sw.querySelector('span > span')?.className).toContain('bg-surface-base');
  });

  it('выключенная строка — дорожка приглушена', () => {
    const { container } = render(<ToggleRow label="Выкл" value={false} onChange={vi.fn()} />);
    const sw = within(container).getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw.querySelector('span')?.className).toContain('bg-text-main/20');
  });

  it('клик по переключателю и по подписи строки каждый вызывает onChange один раз', () => {
    const onChange = vi.fn();
    render(<ToggleRow label="Дзен-режим" value={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Дзен-режим'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('строка — одна цель: клик по отступу строки переключает, фокусируемый элемент один', () => {
    const onChange = vi.fn();
    const { container } = render(<ToggleRow label="Дзен-режим" hint="Скрывает интерфейс" value={false} onChange={onChange} />);
    fireEvent.click(container.firstElementChild!);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });
});
