// /code-review 0.10.0, две кромки R7Q-027:
// (1) closePanelsForNavigation переходит только из popstate: не пришло событие —
//     «Продолжить писать» молча не делает ничего. Нужен запасной таймер.
// (2) releaseClosingBatch уходил назад на размер пачки, даже если между
//     закрытыми записями лежала запись ОТКРЫТОЙ панели — и та закрывалась.
//     Снимать можно только сплошной хвост закрытых записей.
// Мутации: убрать таймер → (1) красный; вернуть go(-размер пачки) → (2) красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

let mod: typeof import('../usePanelHistory');

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  window.history.replaceState(null, '');
  mod = await import('../usePanelHistory');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('история панелей: кромки', () => {
  it('(1) popstate не пришёл — переход всё равно выполняется', () => {
    renderHook(() => mod.usePanelHistory(true, () => undefined, true));
    vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    const run = vi.fn();
    mod.closePanelsForNavigation(run);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('(2) закрылись нижняя и верхняя панели, средняя открыта — средняя не снимается', () => {
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const closeB = vi.fn();
    const a = renderHook(({ open }) => mod.usePanelHistory(open, () => undefined, true), { initialProps: { open: true } });
    renderHook(() => mod.usePanelHistory(true, closeB, true));
    const c = renderHook(({ open }) => mod.usePanelHistory(open, () => undefined, true), { initialProps: { open: true } });

    a.rerender({ open: false });
    c.rerender({ open: false });
    vi.advanceTimersByTime(10);

    expect(go).not.toHaveBeenCalledWith(-2);
    expect(back).toHaveBeenCalledTimes(1);
    expect(closeB).not.toHaveBeenCalled();
  });
});
