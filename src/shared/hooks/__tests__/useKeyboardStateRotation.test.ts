// Ревью 0.9.40 (MC-2): после поворота телефона в ландшафт экран становится ниже,
// и хук принимал это за поднятую клавиатуру — нижняя панель пряталась без неё.
// Мутация: убрать пересъём базы при смене ширины → красный первый кейс.
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardState } from '../useKeyboardState';

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  act(() => { window.dispatchEvent(new Event('resize')); });
}

describe('useKeyboardState: поворот не равен клавиатуре', () => {
  afterEach(() => setViewport(1024, 768));

  it('портрет → ландшафт без клавиатуры: up = false', () => {
    setViewport(390, 844);
    const { result } = renderHook(() => useKeyboardState());
    expect(result.current.up).toBe(false);
    setViewport(844, 390);
    expect(result.current.up).toBe(false);
  });

  it('клавиатура (та же ширина, высота меньше) по-прежнему up = true', () => {
    setViewport(390, 844);
    // Клавиатура бывает только при фокусе в поле (0.10.1).
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    const { result } = renderHook(() => useKeyboardState());
    setViewport(390, 500);
    expect(result.current.up).toBe(true);
  });
});
