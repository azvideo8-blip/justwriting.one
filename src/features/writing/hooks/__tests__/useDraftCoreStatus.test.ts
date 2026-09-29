// R3-018: таймер «Сохранено → пусто» прошлого сохранения гасил ошибку нового.
// R3-019: сохранение во время другого отбрасывалось, и «Сохранено» подтверждало
// текст без последнего абзаца.
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraftCore } from '../useDraftCore';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

describe('useDraftCore', () => {
  it('ошибка после «Сохранено» не гаснет через секунду', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDraftCore({ userId: 'u' }));
      await act(async () => { await result.current.wrapSave(async () => {}, 'a'); });
      expect(result.current.saveStatus).toBe('saved');
      await act(async () => { vi.advanceTimersByTime(300); });
      await act(async () => { await result.current.wrapSave(async () => { throw new Error('idb closed'); }, 'b'); });
      expect(result.current.saveStatus).toBe('error');
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(result.current.saveStatus).toBe('error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('сохранение во время другого не теряется, а выполняется следом', async () => {
    const { result } = renderHook(() => useDraftCore({ userId: 'u' }));
    let release!: () => void;
    const first = vi.fn(() => new Promise<void>(r => { release = r; }));
    const second = vi.fn(async () => {});
    let p!: Promise<boolean>;
    act(() => { p = result.current.wrapSave(first, 'a'); });
    await act(async () => { expect(await result.current.wrapSave(second, 'b')).toBe(false); });
    expect(second).not.toHaveBeenCalled();
    await act(async () => { release(); await p; });
    expect(second).toHaveBeenCalledTimes(1);
  });
});
