// SA-12: плавная прокрутка на каждый кусок потока тянула вниз того, кто ушёл вверх.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { useChatFollow } from '../useChatFollow';

type Props = { count: number; role: string; stream: string };

function Harness({ count, role, stream }: Props) {
  const end = useRef<HTMLDivElement>(null);
  useChatFollow(end, count, role, stream, 'd1');
  return (
    <div data-chat-scroll data-testid="box">
      <div ref={end} />
    </div>
  );
}

describe('useChatFollow (SA-12)', () => {
  let scroll: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    scroll = vi.fn();
    Element.prototype.scrollTo = scroll as unknown as typeof Element.prototype.scrollTo;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  const geometry = (box: HTMLElement, scrollTop: number) => {
    Object.defineProperty(box, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(box, 'clientHeight', { value: 600, configurable: true });
    box.scrollTop = scrollTop;
  };

  it('while streaming it uses behavior auto (never smooth) and follows at the bottom', () => {
    const { rerender } = render(<Harness count={2} role="assistant" stream="" />);
    scroll.mockClear();
    rerender(<Harness count={2} role="assistant" stream="кусок" />);
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    expect(scroll.mock.calls.some(([o]) => o.behavior === 'smooth')).toBe(false);
  });

  it('after the reader scrolls 300 px up, new chunks do not pull the view down', () => {
    const { rerender, getByTestId } = render(<Harness count={2} role="assistant" stream="" />);
    const box = getByTestId('box');
    geometry(box, 1400 - 300); // 2000 - 1100 - 600 = 300 px от низа
    act(() => { box.dispatchEvent(new Event('wheel', { bubbles: true })); });
    scroll.mockClear();
    rerender(<Harness count={2} role="assistant" stream="кусок 1" />);
    rerender(<Harness count={2} role="assistant" stream="кусок 1 кусок 2" />);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('own message sends the view to the end (smooth without reduced motion), even after scrolling up', () => {
    const { rerender, getByTestId } = render(<Harness count={2} role="assistant" stream="" />);
    const box = getByTestId('box');
    geometry(box, 800);
    act(() => { box.dispatchEvent(new Event('wheel', { bubbles: true })); });
    scroll.mockClear();
    rerender(<Harness count={3} role="user" stream="" />);
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  });

  it('reduced motion: own message scrolls without smooth', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduced-motion'), media: q }));
    const { rerender } = render(<Harness count={2} role="assistant" stream="" />);
    scroll.mockClear();
    rerender(<Harness count={3} role="user" stream="" />);
    expect(scroll.mock.calls.every(([o]) => o.behavior === 'auto')).toBe(true);
  });
});
