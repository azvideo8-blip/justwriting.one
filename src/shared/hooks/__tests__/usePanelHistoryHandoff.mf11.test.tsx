// MF-11: лист A закрывается, а лист B открывается в одном действии (пункт
// «Изменить название» в листе действий). Раньше уборка A делала history.back(),
// и асинхронный popstate закрывал только что открытый B.
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { usePanelHistory } from '../usePanelHistory';

function Panel({ name, onClose }: { name: string; onClose: () => void }) {
  usePanelHistory(true, onClose, true);
  return <div role="dialog" aria-label={name} />;
}

function Harness() {
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  return (
    <>
      {a && <Panel name="A" onClose={() => setA(false)} />}
      {b && <Panel name="B" onClose={() => setB(false)} />}
      <button type="button" onClick={() => { setB(true); setA(false); }}>handoff</button>
      <button type="button" onClick={() => setB(false)}>close-b</button>
    </>
  );
}

const flush = () => act(() => new Promise<void>(r => setTimeout(r, 60)));

describe('MF-11: usePanelHistory hand-off', () => {
  it('closing A while opening B in one handler keeps B open, and B closes cleanly', async () => {
    const start = window.history.length;
    render(<Harness />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'handoff' }));
    await flush();
    expect(screen.queryByRole('dialog', { name: 'A' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'B' }), 'B закрыл popstate от уборки A').toBeInTheDocument();
    // Одна запись на две панели, а не две: «назад» после B не застревает на мёртвой записи A.
    expect(window.history.length - start).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'close-b' }));
    await flush();
    expect(screen.queryByRole('dialog', { name: 'B' })).toBeNull();
    expect((window.history.state as { jwPanel?: string } | null)?.jwPanel).toBeUndefined();
  });

  it('hardware back still closes the top panel', async () => {
    let closed = 0;
    render(<Panel name="solo" onClose={() => { closed += 1; }} />);
    await flush();
    act(() => { window.history.back(); });
    await flush();
    expect(closed).toBe(1);
  });
});
