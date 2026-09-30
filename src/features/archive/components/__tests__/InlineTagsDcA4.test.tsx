import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineTags } from '../InlineTags';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'ru' }),
}));

// 2026-09-30: владелец отменил скрытие «+ тег» до hover (DC-A4) — кнопку не находили.
describe('теги в строке: «+ тег» виден всегда', () => {
  it('в строке без тегов — приглушённая плашка «+ тег», без наведения', () => {
    render(<InlineTags variant="row" tags={[]} onChange={vi.fn()} />);
    const add = screen.getByRole('button', { name: 'archive_add_tag_aria' });
    expect(add.textContent).toBe('archive_tag_add_short');
    expect(add.className).not.toContain('opacity-0');
  });

  it('в строке с тегами «+» после них, тоже без наведения', () => {
    render(<InlineTags variant="row" tags={['alpha']} onChange={vi.fn()} />);
    const add = screen.getByRole('button', { name: 'archive_add_tag_aria' });
    expect(add.textContent).toBe('+');
    expect(add.className).not.toContain('opacity-0');
  });

  it('поле ввода, открытое извне, принимает Enter и закрывается наружу', () => {
    const onChange = vi.fn();
    const onStopAdding = vi.fn();
    render(
      <InlineTags
        variant="row"
        tags={[]}
        onChange={onChange}
        isAdding={true}
        onStartAdding={vi.fn()}
        onStopAdding={onStopAdding}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'archive_add_tag_aria' });
    fireEvent.change(input, { target: { value: 'beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['beta']);
    expect(onStopAdding).toHaveBeenCalled();
  });

  it('в панели предпросмотра «+» остаётся видимым, даже когда тегов нет', () => {
    render(<InlineTags tags={[]} onChange={vi.fn()} />);
    const add = screen.getByRole('button', { name: 'archive_add_tag_aria' });
    expect(add.className).not.toContain('opacity-0');
  });
});
