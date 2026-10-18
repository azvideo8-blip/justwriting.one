// N-14 (emil-review, хвост MQ-15): инерционная прокрутка на iPhone.
// `useChatFollow` узнавал об уходе от низа только по wheel/touchmove/keydown. При
// быстром смахивании последний touchmove приходит ещё в 80 px от низа, флаг
// `following` остаётся `true`, и следующий кусок потока утаскивает читателя вниз,
// обрывая инерцию. Правка — считать и по событию `scroll`, но сбрасывать только
// когда человек едет ВВЕРХ.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useChatFollow } from '../useChatFollow';

let scroller!: HTMLDivElement;
let endEl!: HTMLElement;
let streaming = 'кусок 1';
let scrollIntoView!: ReturnType<typeof vi.fn>;

function Harness() {
  const ref = useRef<HTMLElement | null>(endEl);
  useChatFollow(ref, 3, 'assistant', streaming, 'dlg1');
  return ref;
}

function setScrollTop(v: number) {
  Object.defineProperty(scroller, 'scrollTop', { value: v, configurable: true });
  scroller.dispatchEvent(new Event('scroll'));
}

beforeEach(() => {
  scrollIntoView = vi.fn();
  Element.prototype.scrollTo = scrollIntoView as unknown as typeof Element.prototype.scrollTo;
  scroller = document.createElement('div');
  scroller.setAttribute('data-chat-scroll', '');
  endEl = document.createElement('div');
  scroller.appendChild(endEl);
  document.body.appendChild(scroller);
  // Геометрия: контент 1000 px, окно 400 px → у низа это scrollTop 600.
  Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(scroller, 'scrollTop', { value: 600, configurable: true, writable: true });
  streaming = 'кусок 1';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('N-14: инерционный скролл', () => {
  it('уход вверх дальше порога — следующий кусок потока читателя не трогает', () => {
    const { rerender } = renderHook(() => Harness());
    scrollIntoView.mockClear();

    // Резкое смахивание: была у низа (600), уехала на 300 — это в 300 px от низа.
    act(() => { setScrollTop(300); });

    act(() => { streaming = 'кусок 2'; rerender(); });
    expect(scrollIntoView, 'читателя утащило вниз во время чтения').not.toHaveBeenCalled();
  });

  it('смаховое движение вниз, ещё не у конца, авто-follow сохраняет', () => {
    const { rerender } = renderHook(() => Harness());
    act(() => { setScrollTop(560); }); // 40 px от низа — всё ещё «у конца»
    scrollIntoView.mockClear();
    act(() => { streaming = 'кусок 2'; rerender(); });
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('программа сама себя не сбрасывает: движение вниз к концу не отменяет follow', () => {
    const { rerender } = renderHook(() => Harness());
    scrollIntoView.mockClear();
    // Собственный scrollIntoView даёт scroll-событие с ростом scrollTop.
    act(() => { setScrollTop(600); });
    act(() => { streaming = 'кусок 2'; rerender(); });
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
