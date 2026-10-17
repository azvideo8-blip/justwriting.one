// N-4 (emil-review, хвост MQ-15): панель листа лежала ВНУТРИ затемнения, у которого
// анимируется прозрачность, — 200 мс на входе и 200 мс на уходе сплошной по MF-20
// лист был полупрозрачным, и сквозь него видна лента. Здесь проверяется причина,
// а не ощущение: у [role=dialog] не должно быть предка с классом затемнения,
// затемнение — его сосед.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModalShell } from '../ModalShell';

vi.mock('../../hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'mobile' }) }));
vi.mock('../../hooks/usePanelHistory', () => ({ usePanelHistory: vi.fn() }));
vi.mock('../../hooks/useFocusTrap', () => ({ useFocusTrap: () => ({}) }));
vi.mock('../../hooks/useModalEscape', () => ({ useModalEscape: vi.fn() }));

function renderSheet() {
  return render(
    <ModalShell open onClose={vi.fn()} labelId="t-n4" variant="sheet">
      <p>sheet body</p>
    </ModalShell>,
  );
}

describe('N-4: затемнение — сосед листа, а не его родитель', () => {
  it('у диалога нет предка со слоем затемнения', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('[class*="bg-black"]'), 'лист лежит внутри фейдящегося затемнения').toBeNull();
  });

  it('затемнение живёт отдельным слоем рядом с листом', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog');
    const scrim = document.querySelector('[class*="bg-black"][class*="backdrop-blur"]');
    expect(scrim, 'нет отдельного слоя затемнения — лист снова поедет полупрозрачным').not.toBeNull();
    expect(scrim!.contains(dialog)).toBe(false);
    expect(dialog.parentElement!.contains(scrim), 'затемнение не сосед листа').toBe(true);
  });

  it('десктопная модалка не изменилась: у неё своё затемнение с размытием', () => {
    render(
      <ModalShell open onClose={vi.fn()} labelId="t-n4-modal" variant="modal">
        <p>modal body</p>
      </ModalShell>,
    );
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement!;
    expect(backdrop.className).toContain('backdrop-blur');
    expect(backdrop.className).toContain('bg-surface-base');
  });
});
