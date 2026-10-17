// MQ-12 (N-3): галочки мастера первого входа — поле 24 px, цель касания 44 px.
// Здесь проверяется механизм (растянутый по строке input + нарисованный квадрат);
// сам размер цели касания по-настоящему меряет мобильный спек
// e2e/mobile/stepper-no-small-targets.mq12.spec.ts через smallTargets().
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CheckboxRow } from '../CheckboxRow';

describe('MQ-12: CheckboxRow', () => {
  it('весь ряд — зона нажатия, квадрат 24 px остаётся', () => {
    const onChange = vi.fn();
    render(<CheckboxRow checked={false} onChange={onChange}>read-and-accept</CheckboxRow>);
    const box = screen.getByRole('checkbox', { name: 'read-and-accept' });
    const label = box.closest('label')!;
    expect(label.className, 'ряд без высоты 44 px').toContain('min-h-11');
    expect(box.className, 'input не растянут на ряд').toContain('inset-0');
    expect(box.className, 'input не прозрачен — рисунок сдвоится').toContain('opacity-0');
    const drawn = label.querySelector('span[aria-hidden="true"]');
    expect(drawn, 'нет нарисованного квадрата').not.toBeNull();
    expect(drawn!.className, 'квадрат не 24 px').toContain('h-6');
  });

  it('клик по подписи переключает, состояние рисунка следует за состоянием', () => {
    const onChange = vi.fn();
    const { rerender } = render(<CheckboxRow checked={false} onChange={onChange}>agree</CheckboxRow>);
    fireEvent.click(screen.getByText('agree'));
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<CheckboxRow checked onChange={onChange}>agree</CheckboxRow>);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(document.querySelector('[aria-hidden="true"] svg'), 'отметка не показана').not.toBeNull();
  });
});
