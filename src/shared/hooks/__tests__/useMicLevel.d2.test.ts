// D-2: индикатор уровня входа.
//
// Проверяется то, за чем хук существует: микрофон взят один раз и ОТПУЩЕН при
// выключении (иначе в вкладке горит индикатор записи), отказ getUserMedia не
// роняет диктовку и не даёт тост, а уровень считает RMS, а не «есть ли данные».
//
// Мутация: убрать цикл stop() у треков → (a) красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMicLevel } from '../useMicLevel';

const gUM = vi.fn();
const frames: FrameRequestCallback[] = [];
let analyserData = new Uint8Array(256);
let closeCalls = 0;
let now = 0;

class FakeAnalyser {
  fftSize = 0;
  getByteTimeDomainData(out: Uint8Array) { out.set(analyserData); }
}

class FakeAudioContext {
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  createAnalyser = vi.fn(() => new FakeAnalyser());
  close = vi.fn(() => { closeCalls += 1; return Promise.resolve(); });
  resume = vi.fn(() => Promise.resolve());
}

function makeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { tracks, stream: { getTracks: () => tracks } as unknown as MediaStream };
}

/** Прокручивает n кадров анимации, сдвигая часы на 100 мс между ними. */
function pump(n: number) {
  act(() => {
    for (let i = 0; i < n; i++) {
      now += 100;
      const queued = frames.splice(0, frames.length);
      queued.forEach(cb => cb(now));
    }
  });
}

beforeEach(() => {
  frames.length = 0;
  closeCalls = 0;
  now = 100;
  analyserData = new Uint8Array(256).fill(128);
  gUM.mockReset();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { /* очередь чистится в pump */ });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: gUM }, configurable: true, writable: true,
  });
  Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true, writable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('D-2: useMicLevel', () => {
  it('(a) включение берёт микрофон один раз, выключение отпускает треки и закрывает контекст', async () => {
    const { tracks, stream } = makeStream();
    gUM.mockResolvedValue(stream);
    const { result, rerender } = renderHook(({ active }) => useMicLevel(active), { initialProps: { active: false } });

    expect(gUM).not.toHaveBeenCalled();
    rerender({ active: true });
    await act(async () => { await Promise.resolve(); });
    expect(gUM).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    await act(async () => { await Promise.resolve(); });
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(tracks[1]!.stop).toHaveBeenCalledTimes(1);
    expect(closeCalls).toBe(1);
    expect(result.current.level).toBe(0);
  });

  it('(b) размонтирование во время записи делает ту же уборку', async () => {
    const { tracks, stream } = makeStream();
    gUM.mockResolvedValue(stream);
    const { result, unmount } = renderHook(() => useMicLevel(true));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.failed).toBe(false);

    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(closeCalls).toBe(1);
  });

  it('(c) отказ микрофона: failed, уровень ноль, ничего не брошено', async () => {
    gUM.mockRejectedValue(new Error('NotAllowedError'));
    const { result } = renderHook(() => useMicLevel(true));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.failed).toBe(true);
    expect(result.current.level).toBe(0);
  });

  it('(d) громкий буфер → уровень около 1, плоский → около 0', async () => {
    const { stream } = makeStream();
    gUM.mockResolvedValue(stream);

    const loud = new Uint8Array(256);
    for (let i = 0; i < 256; i++) loud[i] = i % 2 === 0 ? 255 : 1;
    analyserData = loud;

    const { result } = renderHook(() => useMicLevel(true));
    await act(async () => { await Promise.resolve(); });
    pump(20);
    expect(result.current.level).toBeGreaterThan(0.85);

    analyserData = new Uint8Array(256).fill(128);
    pump(40);
    expect(result.current.level).toBeLessThan(0.01);
  });
});
