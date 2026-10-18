// Ревью 0.10.1: листы сейфа (z="critical", ввод пароля) свайпом не закрываются.
// Мутация: убрать `z !== 'critical'` из swipeable → красный.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ModalShell } from '../ModalShell';

describe('sheet swipe: critical sheets', () => {
  it('an ordinary sheet is swipeable, a critical one is not', () => {
    const { unmount } = render(<ModalShell open onClose={vi.fn()} variant="sheet" labelId="t"><p>x</p></ModalShell>);
    expect(document.querySelector('[data-sheet-swipe]')).not.toBeNull();
    unmount();
    render(<ModalShell open onClose={vi.fn()} variant="sheet" z="critical" labelId="t"><p>x</p></ModalShell>);
    expect(document.querySelector('[data-sheet-swipe]')).toBeNull();
  });
});
