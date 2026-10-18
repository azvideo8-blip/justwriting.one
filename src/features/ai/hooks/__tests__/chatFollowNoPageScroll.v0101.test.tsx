// Скрин владельца 2026-10-17 (iPhone): при выборе длинного диалога шапка экрана
// ИИ (☰, собеседник, «+») уезжает, и её нужно долго листать обратно. Шапка стоит
// вне прокрутки чата, но scrollIntoView прокручивает ВСЕХ прокручиваемых предков,
// включая страницу. Чат обязан прокручивать только свой контейнер.
// Мутация: вернуть scrollIntoView → красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { useChatFollow } from '../useChatFollow';

function Harness({ dialogue }: { dialogue: string }) {
  const end = useRef<HTMLDivElement>(null);
  useChatFollow(end, 40, 'assistant', '', dialogue);
  return <div data-chat-scroll data-testid="box"><div ref={end} /></div>;
}

describe('чат не прокручивает страницу', () => {
  let intoView: ReturnType<typeof vi.fn>;
  let scrollTo: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    intoView = vi.fn();
    scrollTo = vi.fn();
    Element.prototype.scrollIntoView = intoView as unknown as typeof Element.prototype.scrollIntoView;
    Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
  });
  afterEach(() => cleanup());

  it('открытие другого диалога прокручивает только контейнер чата', () => {
    const { rerender, getByTestId } = render(<Harness dialogue="d1" />);
    Object.defineProperty(getByTestId('box'), 'scrollHeight', { configurable: true, value: 5000 });
    intoView.mockClear(); scrollTo.mockClear();
    rerender(<Harness dialogue="d2" />);
    expect(intoView, 'scrollIntoView прокручивает и страницу').not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 5000 }));
  });
});
