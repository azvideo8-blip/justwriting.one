// A-12: гейт по коду — каждый кадр гида имеет WebP-источник, и файлы srcset
// существуют. Мутация: удалить любой .webp из public/docs → тест красный.
import { describe, it, expect } from 'vitest';
import { findBrokenDocPictures } from '../../../scripts/check-docs-webp.mjs';

describe('A-12: кадры руководства через <picture>/WebP', () => {
  it('у каждого <img> есть WebP-источник с существующими файлами', () => {
    expect(findBrokenDocPictures(process.cwd())).toEqual([]);
  });
});
