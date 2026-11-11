import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallAi } = vi.hoisted(() => ({ mockCallAi: vi.fn() }));
vi.mock('../../../../core/ai/callAi', () => ({
  callAi: mockCallAi,
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

  // N1: judgeFacets used to return raw Firebase error codes
  // (e.g. 'internal'), but the caller in AIFacetJudgeService compared against
  // normalised codes ('SERVER_ERROR', 'RATE_LIMIT', 'DAILY_LIMIT'), so the
  // break condition never fired and every chunk got its own failure.
  describe('judgeFacets reports a normalised error code', () => {
    beforeEach(() => mockCallAi.mockReset());

    it('maps a transport failure to a code the caller actually checks', async () => {
      mockCallAi.mockRejectedValueOnce(Object.assign(new Error('internal'), { code: 'functions/internal' }));
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
      mockCallAi.mockRejectedValueOnce(Object.assign(new Error('deadline-exceeded'), { code: 'functions/deadline-exceeded' }));
      const res = await AIService.judgeFacets({ facets: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).not.toBe('deadline-exceeded');
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
    beforeEach(() => mockCallAi.mockReset());

    it('deadline-exceeded → NETWORK', async () => {
      mockCallAi.mockRejectedValueOnce(Object.assign(new Error('deadline-exceeded'), { code: 'functions/deadline-exceeded' }));
      const res = await AIService.judgeFacets({ facets: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('NETWORK');
    });

    it('internal with message "internal" → NETWORK', async () => {
      mockCallAi.mockRejectedValueOnce(Object.assign(new Error('internal'), { code: 'functions/internal' }));
      const res = await AIService.judgeFacets({ facets: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('NETWORK');
    });

    it('internal with message "UNKNOWN" → SERVER_ERROR, not NETWORK', async () => {
      mockCallAi.mockRejectedValueOnce(Object.assign(new Error('UNKNOWN'), { code: 'functions/internal' }));
      const res = await AIService.judgeFacets({ facets: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('SERVER_ERROR');
    });

    it('unauthenticated → AUTH_REQUIRED', async () => {
      mockCallAi.mockRejectedValueOnce(Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' }));
      const res = await AIService.judgeFacets({ facets: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('AUTH_REQUIRED');
    });

    it('unavailable → UPSTREAM', async () => {
      mockCallAi.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'functions/unavailable' }));
      const res = await AIService.judgeFacets({ facets: [] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('UPSTREAM');
    });

    it('DEEP-13: model output schema failure surfaces as UPSTREAM, not TOO_LONG', async () => {
      mockCallAi.mockRejectedValueOnce(Object.assign(new Error('Model returned malformed summary.'), { code: 'unavailable', status: 503 }));
      const res = await AIService.summarize({ content: 'text' });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe('UPSTREAM');
        expect(res.error).not.toBe('TOO_LONG');
      }
    });

    it('DEEP-13: client input too long / invalid argument surfaces as TOO_LONG', async () => {
      mockCallAi.mockRejectedValueOnce(Object.assign(new Error('Invalid payload.'), { code: 'invalid-argument', status: 400 }));
      const res = await AIService.summarize({ content: 'text' });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('TOO_LONG');
    });
  });
});
