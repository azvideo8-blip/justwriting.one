import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { getDomainSeedVectors, __resetDomainSeedCache } from '../domainSeeds';
import { LIFE_DOMAINS } from '../lifeDomains';

// Mock AIService so no network calls happen. The path resolves to the same
// module that domainSeeds.ts imports, so the replacement is shared.
vi.mock('../../services/AIService', () => ({
  AIService: {
    embed: vi.fn(),
  },
}));

// Import AFTER vi.mock so we get the mocked instance.
import { AIService } from '../../services/AIService';

const embedMock = AIService.embed as unknown as MockedFunction<typeof AIService.embed>;

function okVec(): { ok: true; vectors: number[][]; chunks: string[]; model: string; dim: number } {
  return { ok: true, vectors: [[0.1, 0.2, 0.3]], chunks: [], model: 'm', dim: 3 };
}

beforeEach(() => {
  __resetDomainSeedCache();
  embedMock.mockReset();
});

describe('getDomainSeedVectors', () => {
  it('embeds each domain seed once on the first call', async () => {
    embedMock.mockResolvedValue(okVec());
    const vecs = await getDomainSeedVectors();
    expect(vecs).toHaveLength(LIFE_DOMAINS.length);
    expect(embedMock).toHaveBeenCalledTimes(LIFE_DOMAINS.length);
  });

  it('second call uses the cache and makes ZERO additional embed calls', async () => {
    embedMock.mockResolvedValue(okVec());
    await getDomainSeedVectors();
    const firstCount = embedMock.mock.calls.length;
    expect(firstCount).toBe(LIFE_DOMAINS.length);
    await getDomainSeedVectors();
    expect(embedMock.mock.calls.length).toBe(firstCount);
  });

  it('skips domains whose embed fails', async () => {
    embedMock.mockImplementation((params: { content: string }) => {
      if (params.content.includes('самореализация')) {
        return Promise.resolve({ ok: false, error: 'SERVER_ERROR' });
      }
      return Promise.resolve(okVec());
    });
    const vecs = await getDomainSeedVectors();
    expect(vecs).toHaveLength(LIFE_DOMAINS.length - 1);
    expect(vecs.find(v => v.id === 'selfreal')).toBeUndefined();
  });

  it('returns [] when all embeds fail', async () => {
    embedMock.mockResolvedValue({ ok: false, error: 'SERVER_ERROR' });
    const vecs = await getDomainSeedVectors();
    expect(vecs).toEqual([]);
  });

  it('carries each domain threshold from LIFE_DOMAINS (falling back to the default)', async () => {
    embedMock.mockResolvedValue(okVec());
    const vecs = await getDomainSeedVectors();
    // Assert the carry-through mechanism, not specific tuned values (those move).
    for (const d of LIFE_DOMAINS) {
      const v = vecs.find(x => x.id === d.id);
      expect(v?.threshold).toBe(d.threshold ?? 0.45);
    }
  });
});
