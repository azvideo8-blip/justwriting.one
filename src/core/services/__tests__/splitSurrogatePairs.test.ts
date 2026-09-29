// R3-014: граница страницы не режет суррогатную пару — иначе половинка эмодзи
// превращается в U+FFFD при шифровании, и облачная копия записи портится.
import { describe, it, expect, vi } from 'vitest';
import { splitStringIntoChunks } from '../LocalStoreSyncService';

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

describe('splitStringIntoChunks', () => {
  it.each([1, 2, 3])('эмодзи после %i символов переживают разбиение и UTF-8', pad => {
    const src = 'a'.repeat(pad) + '😀🙂'.repeat(20);
    for (const size of [4, 5, 6, 7, 9]) {
      const chunks = splitStringIntoChunks(src, size);
      expect(chunks.join('')).toBe(src);
      for (const c of chunks) {
        expect(new TextDecoder().decode(new TextEncoder().encode(c))).toBe(c);
      }
    }
  });
});
