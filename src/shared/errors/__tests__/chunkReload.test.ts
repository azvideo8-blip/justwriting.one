import { describe, it, expect, vi } from 'vitest';
import { chunkIsGone } from '../chunkReload';

const msg = 'Failed to fetch dynamically imported module: https://justwriting.ru/assets/AIRestoreService-DfUqpo-v.js';

describe('vite:preloadError — reload only for a chunk that is really gone', () => {
  it('404 after a deploy → reload', async () => {
    const f = vi.fn().mockResolvedValue({ status: 404 });
    expect(await chunkIsGone(msg, f as unknown as typeof fetch)).toBe(true);
    expect(f).toHaveBeenCalledWith('https://justwriting.ru/assets/AIRestoreService-DfUqpo-v.js', { method: 'HEAD', cache: 'no-store' });
  });

  it('the chunk is there (the import failed on a network blip) → no reload', async () => {
    expect(await chunkIsGone(msg, vi.fn().mockResolvedValue({ status: 200 }) as unknown as typeof fetch)).toBe(false);
  });

  it('the server is unreachable (VPN, offline) → no reload', async () => {
    expect(await chunkIsGone(msg, vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch)).toBe(false);
  });

  it('an error without a chunk URL keeps the old behaviour', async () => {
    expect(await chunkIsGone('something else', vi.fn() as unknown as typeof fetch)).toBe(true);
  });
});
