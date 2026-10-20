import { describe, it, expect } from 'vitest';
import { canStartSheetDrag } from '../ModalShell';

// UI-1: лист закрывался перетаскиванием мышью — на десктопе это мешало
// выделять текст и «тащило» лист при обычном клике. Свайп — только палец/перо.
describe('UI-1: свайп листа не начинается мышью', () => {
  it('мышь не тащит лист, касание и перо тащат', () => {
    const root = document.createElement('div');
    const row = document.createElement('p');
    row.textContent = 'строка листа';
    root.appendChild(row);
    document.body.appendChild(root);
    try {
      expect(canStartSheetDrag(row, root, 'mouse')).toBe(false);
      expect(canStartSheetDrag(row, root, 'touch')).toBe(true);
      expect(canStartSheetDrag(row, root, 'pen')).toBe(true);
    } finally {
      root.remove();
    }
  });
});
