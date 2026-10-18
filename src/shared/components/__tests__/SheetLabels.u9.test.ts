// U-9 (решение владельца 2026-10-18): метка раздела на телефоне приводится к
// десктопу — моноширинный капс с разрядкой, но не мельче 12 px. Прежний SA-15
// держал здесь строчные Quiet Label; правило переписано под десктоп-эталон.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SECTION_LABEL } from '../ModalShell';

describe('U-9: mobile section labels follow the desktop mono-caps rule', () => {
  it('the shared label is mono caps with tracking', () => {
    expect(SECTION_LABEL).toMatch(/font-mono/);
    expect(SECTION_LABEL).toMatch(/uppercase/);
    expect(SECTION_LABEL).toMatch(/tracking-widest/);
  });

  it('the shared label is never smaller than 12 px', () => {
    const sizes = [...SECTION_LABEL.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map(m => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(12);
  });

  it('the shared label is on tokens, not a raw colour', () => {
    expect(SECTION_LABEL).not.toMatch(/white\/|black\/|rgba\(|#[0-9a-fA-F]{3,8}/);
  });

  it('«Записано.» keeps one shared label class, not a home-grown one', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/features/writing/components/FinishModalTags.tsx'), 'utf8');
    expect(src).toMatch(/SECTION_LABEL/);
  });
});
