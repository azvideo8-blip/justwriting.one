// DC-W5: переключение клавиатуры в дзене. Tab и модификаторы — это навигация,
// они не должны прятать UI обратно, иначе до кнопок шапки нельзя дойти.
// Обычная клавиша (печать) по-прежнему прячет.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React, { useEffect } from 'react';
import { WritingSettingsProvider, useWritingSettings } from '../WritingSettingsContext';

function Probe() {
  const { isZenActive, setStatus } = useWritingSettings();
  useEffect(() => { setStatus('writing'); }, [setStatus]);
  return <span data-testid="zen">{String(isZenActive)}</span>;
}

describe('DC-W5: клавиши скрытия UI в дзене', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('Tab показывает UI, буква — прячет', () => {
    vi.useFakeTimers();
    render(
      <WritingSettingsProvider>
        <Probe />
      </WritingSettingsProvider>
    );
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.getByTestId('zen')).toHaveTextContent('true');

    // движение мыши — интерфейс показан
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 120 })); });
    expect(screen.getByTestId('zen')).toHaveTextContent('false');

    for (const key of ['Tab', 'Shift', 'Alt', 'Control', 'Meta']) {
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key })); });
      expect(screen.getByTestId('zen'), `клавиша ${key} не должна прятать UI`).toHaveTextContent('false');
    }

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'а' })); });
    expect(screen.getByTestId('zen')).toHaveTextContent('true');
  });
});
