import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineTags } from '../InlineTags';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'ru' }),
}));

describe('DC-A4 теги: пустая строка без плашки «+ тег»', () => {
  it('в строке без тегов не рисуется ничего', () => {
    const { container } = render(
      <InlineTags variant="row" tags={[]} onChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('button', { name: 'archive_add_tag_aria' })).not.toBeInTheDocument();
  });

  it('в строке с тегами «+» без пунктира и без mono и скрыт до hover строки', () => {
    render(<InlineTags variant="row" tags={['alpha']} onChange={vi.fn()} />);
    const add = screen.getByRole('button', { name: 'archive_add_tag_aria' });
    expect(add.textContent).toBe('+');
    expect(add.className).toContain('opacity-0');
    expect(add.className).toContain('group-hover:opacity-100');
    expect(add.className).toContain('group-focus-within:opacity-100');
    expect(add.className).not.toContain('border-dashed');
    expect(add.className).not.toContain('font-mono');
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
