// Скрин владельца 2026-10-17 (iPhone, Яндекс Браузер): при входе на сайт нет
// нижней панели вкладок; после перезагрузки — есть. Панель браузера в две строки
// выезжает после загрузки, окно становится ниже на >130 px, и хук принимал это
// за клавиатуру («сжатие вьюпорта», MC-2). Клавиатуры без фокуса в поле ввода не
// бывает. Мутация: убрать проверку фокуса → красный первый кейс.
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardState } from '../useKeyboardState';

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  act(() => { window.dispatchEvent(new Event('resize')); });
}

describe('useKeyboardState: клавиатура только при фокусе в поле', () => {
  afterEach(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.innerHTML = '';
    setViewport(1024, 768);
  });

  it('окно стало ниже без фокуса в поле (выехала панель браузера) — up = false', () => {
    setViewport(390, 844);
    const { result } = renderHook(() => useKeyboardState());
    setViewport(390, 690);
    expect(result.current.up).toBe(false);
  });

  it('то же сжатие при фокусе в textarea — up = true', () => {
    setViewport(390, 844);
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const { result } = renderHook(() => useKeyboardState());
    act(() => { ta.focus(); });
    setViewport(390, 500);
    expect(result.current.up).toBe(true);
  });

  it('фокус ушёл из поля — клавиатуры нет, даже если окно ещё не выросло', () => {
    setViewport(390, 844);
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const { result } = renderHook(() => useKeyboardState());
    act(() => { ta.focus(); });
    setViewport(390, 500);
    act(() => { ta.blur(); });
    expect(result.current.up).toBe(false);
  });
});
