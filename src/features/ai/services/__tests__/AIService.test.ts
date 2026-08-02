import { describe, it, expect, vi, beforeEach } from 'vitest';

const callable = vi.fn();
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => callable,
}));
vi.mock('../../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

import { AIService } from '../AIService';

describe('AIService', () => {
  describe('parseTags', () => {
    it('parses valid JSON array', () => {
      expect(AIService.parseTags('["tag1","tag2","tag3"]')).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('returns empty array for invalid JSON', () => {
      expect(AIService.parseTags('not json')).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(AIService.parseTags('')).toEqual([]);
    });

    it('parses single-item array', () => {
      expect(AIService.parseTags('["only"]')).toEqual(['only']);
    });
  });

  // N1: judgeFacets and deriveTaxonomy used to return raw Firebase error codes
  // (e.g. 'internal'), but the caller in AIFacetJudgeService compared against
  // normalised codes ('SERVER_ERROR', 'RATE_LIMIT', 'DAILY_LIMIT'), so the
  // break condition never fired and every chunk got its own failure.
  describe('judgeFacets reports a normalised error code', () => {
    beforeEach(() => callable.mockReset());

    it('maps a transport failure to a code the caller actually checks', async () => {
      callable.mockRejectedValueOnce(Object.assign(new Error('internal'), { code: 'functions/internal' }));
      const res = await AIService.judgeFacets({ facets: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(['SERVER_ERROR', 'RATE_LIMIT', 'DAILY_LIMIT', 'AUTH_REQUIRED', 'UPSTREAM', 'TOO_LONG', 'NETWORK'])
          .toContain(res.error);
        // Exactly this was broken: the raw Firebase code never matched.
        expect(res.error).not.toBe('internal');
      }
    });

    it('maps deadline-exceeded to a normalised code', async () => {
      callable.mockRejectedValueOnce(Object.assign(new Error('deadline-exceeded'), { code: 'functions/deadline-exceeded' }));
      const res = await AIService.judgeFacets({ facets: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).not.toBe('deadline-exceeded');
        expect(['SERVER_ERROR', 'RATE_LIMIT', 'DAILY_LIMIT', 'AUTH_REQUIRED', 'UPSTREAM', 'TOO_LONG', 'NETWORK'])
          .toContain(res.error);
      }
    });
  });

  describe('deriveTaxonomy reports a normalised error code', () => {
    beforeEach(() => callable.mockReset());

    it('maps a transport failure to a normalised code', async () => {
      callable.mockRejectedValueOnce(Object.assign(new Error('internal'), { code: 'functions/internal' }));
      const res = await AIService.deriveTaxonomy({ digest: 'test' });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).not.toBe('internal');
        expect(['SERVER_ERROR', 'RATE_LIMIT', 'DAILY_LIMIT', 'AUTH_REQUIRED', 'UPSTREAM', 'TOO_LONG', 'NETWORK'])
          .toContain(res.error);
      }
    });
  });

  // N2: mapAIError distinguishes network failures from application errors.
  // The third case is the most important: 'internal' with a specific message
  // (UNKNOWN / BAD_REQUEST / MISCONFIGURED) is our function failing, NOT a
  // transport issue — downgrading it to NETWORK would hide real bugs.
  describe('mapAIError maps transport failures to NETWORK', () => {
    beforeEach(() => callable.mockReset());

    it('deadline-exceeded → NETWORK', async () => {
      callable.mockRejectedValueOnce(Object.assign(new Error('deadline-exceeded'), { code: 'functions/deadline-exceeded' }));
      const res = await AIService.judgeFacets({ facets: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('NETWORK');
    });

    it('internal with message "internal" → NETWORK', async () => {
      callable.mockRejectedValueOnce(Object.assign(new Error('internal'), { code: 'functions/internal' }));
      const res = await AIService.judgeFacets({ facets: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('NETWORK');
    });

    it('internal with message "UNKNOWN" → SERVER_ERROR, not NETWORK', async () => {
      callable.mockRejectedValueOnce(Object.assign(new Error('UNKNOWN'), { code: 'functions/internal' }));
      const res = await AIService.judgeFacets({ facets: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('SERVER_ERROR');
    });

    it('unauthenticated → AUTH_REQUIRED', async () => {
      callable.mockRejectedValueOnce(Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' }));
      const res = await AIService.judgeFacets({ facets: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('AUTH_REQUIRED');
    });

    it('unavailable → UPSTREAM', async () => {
      callable.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'functions/unavailable' }));
      const res = await AIService.judgeFacets({ facets: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('UPSTREAM');
    });
  });
});
