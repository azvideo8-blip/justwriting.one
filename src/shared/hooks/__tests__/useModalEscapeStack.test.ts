import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useModalEscape } from '../useModalEscape';

describe('B-5.4 (F-026) useModalEscape closes topmost modal first', () => {
  it('closes only the topmost open modal (B) and not the bottom one (A) on Escape', () => {
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();

    // Modal A opens first (bottom modal)
    const hookA = renderHook(({ open }) => useModalEscape(open, onCloseA), {
      initialProps: { open: true },
    });

    // Modal B opens second (top modal)
    const hookB = renderHook(({ open }) => useModalEscape(open, onCloseB), {
      initialProps: { open: true },
    });

    // Press Escape
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    // Only topmost modal B should have closed
    expect(onCloseB).toHaveBeenCalledTimes(1);
    expect(onCloseA).not.toHaveBeenCalled();

    hookB.unmount();
    hookA.unmount();
  });
});
