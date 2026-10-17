// Снимок владельца 2026-10-17 (iPhone, Safari): панель письма висит над
// клавиатурой с пустой полосой. iOS не сжимает layout-вьюпорт, а при открытой
// клавиатуре ещё и прокручивает видимую область к каретке (visualViewport.offsetTop).
// Панель стоит `fixed` от низа layout-вьюпорта, значит до верха клавиатуры от низа —
// innerHeight − (offsetTop + vv.height), а не innerHeight − vv.height: прежняя
// формула поднимала панель ровно на offsetTop. Прокрутка видимой области к тому же
// не шлёт resize — только scroll, — и панель «подскакивала» с задержкой.
// Мутация: вернуть overlay = innerHeight − vv.height или убрать подписку на scroll → красный.
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardState } from '../useKeyboardState';

class FakeVV extends EventTarget {
  height: number;
  offsetTop = 0;
  constructor(h: number) { super(); this.height = h; }
}

function install(innerH: number, vv: FakeVV): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerH });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
}

describe('useKeyboardState: прокрученная видимая область iOS', () => {
  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
  });

  it('overlay — расстояние от низа layout-вьюпорта до верха клавиатуры с учётом offsetTop', () => {
    const vv = new FakeVV(844);
    install(844, vv);
    const { result } = renderHook(() => useKeyboardState());
    expect(result.current).toEqual({ overlay: 0, up: false });

    // Клавиатура 336 px: видимая область 508, iOS прокрутил её на 120 к каретке.
    act(() => { vv.height = 508; vv.offsetTop = 120; vv.dispatchEvent(new Event('resize')); });
    expect(result.current.up).toBe(true);
    expect(result.current.overlay).toBe(844 - 120 - 508);
  });

  it('прокрутка видимой области без resize пересчитывает overlay', () => {
    const vv = new FakeVV(508);
    install(844, vv);
    const { result } = renderHook(() => useKeyboardState());
    expect(result.current.overlay).toBe(336);

    act(() => { vv.offsetTop = 200; vv.dispatchEvent(new Event('scroll')); });
    expect(result.current.overlay).toBe(136);
    expect(result.current.up, 'клавиатура не исчезла от прокрутки').toBe(true);
  });
});
