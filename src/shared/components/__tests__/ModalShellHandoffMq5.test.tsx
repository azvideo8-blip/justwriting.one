import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { ModalShell } from '../ModalShell';

// MQ-5: лист открывается, пока прежний ещё на экране (действия → переименование) —
// его затемнение стартует с полной непрозрачности, а не с нуля, иначе на кадр
// проступает страница. Единственный лист по-прежнему проявляется из нуля.
const sheet = (id: string) => (
  <ModalShell open labelId={id} onClose={() => {}} variant="sheet"><h2 id={id}>{id}</h2></ModalShell>
);
const backdropOpacity = (id: string) =>
  (document.getElementById(id)!.closest('[role="dialog"]')!.parentElement as HTMLElement).style.opacity;
const settle = () => act(() => new Promise<void>(r => setTimeout(r, 300)));

describe('MQ-5: затемнение листа при смене листа', () => {
  afterEach(async () => { cleanup(); await settle(); });

  it('единственный лист проявляется из нуля', () => {
    render(sheet('a'));
    expect(backdropOpacity('a')).toBe('0');
  });

  it('второй лист поверх первого стартует с полной непрозрачности', () => {
    const { rerender } = render(<>{sheet('first')}</>);
    rerender(<>{sheet('first')}{sheet('second')}</>);
    expect(backdropOpacity('first')).toBe('0');
    expect(backdropOpacity('second')).toBe('1');
  });
});
