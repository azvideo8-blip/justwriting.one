// R3-018: таймер «Сохранено → пусто» прошлого сохранения гасил ошибку нового.
// R3-019: сохранение во время другого отбрасывалось, и «Сохранено» подтверждало
// текст без последнего абзаца.
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraftCore } from '../useDraftCore';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
const sync = vi.hoisted(() => ({ on: true }));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => sync.on }));

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

  // N1 вопрос 3 (владелец 02.11): облако отказало навсегда — статус называет
  // причину, а не обещает досылку. Мутация: не ставить permanentKindRef → красный.
  it('отказ облака навсегда: размер — cloud-too-large, прочее — cloud-refused, удача снимает', async () => {
    const { result } = renderHook(() => useDraftCore({ userId: 'u' }));
    await act(async () => {
      await result.current.wrapSave(async () => ({ remoteOk: false, remoteError: { code: '23514', message: 'new row violates check constraint "drafts_content_check"' } }), 'a');
    });
    expect(result.current.saveStatus).toBe('cloud-stale');
    expect(result.current.saveErrorKind).toBe('cloud-too-large');

    await act(async () => {
      await result.current.wrapSave(async () => ({ remoteOk: false, remoteError: { status: 403, message: 'forbidden' } }), 'b');
    });
    expect(result.current.saveErrorKind).toBe('cloud-refused');

    await act(async () => { await result.current.wrapSave(async () => ({ remoteOk: true }), 'c'); });
    expect(result.current.saveStatus).toBe('saved');
    expect(result.current.saveErrorKind).toBeNull();
  });

  // Ревью 0.11.3: при выключенной синхронизации досылки нет — подсказка не обещает её.
  // Мутация: убрать ветку cloudSyncEnabled → красный.
  it('синхронизация выключена: причина cloud-off, а не обещание досылки', async () => {
    sync.on = false;
    try {
      const { result } = renderHook(() => useDraftCore({ userId: 'u' }));
      for (const a of ['a', 'b', 'c']) {
        await act(async () => { await result.current.wrapSave(async () => ({ remoteOk: false }), a); });
      }
      expect(result.current.saveStatus).toBe('cloud-stale');
      expect(result.current.saveErrorKind).toBe('cloud-off');
    } finally {
      sync.on = true;
    }
  });

  it('временный отказ облака причину не называет — досылка обещана честно', async () => {
    const { result } = renderHook(() => useDraftCore({ userId: 'u' }));
    for (const a of ['a', 'b', 'c']) {
      await act(async () => {
        await result.current.wrapSave(async () => ({ remoteOk: false, remoteError: { status: 503, message: 'unavailable' } }), a);
      });
    }
    expect(result.current.saveStatus).toBe('cloud-stale');
    expect(result.current.saveErrorKind).toBeNull();
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
