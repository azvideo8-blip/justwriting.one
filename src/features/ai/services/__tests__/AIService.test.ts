import { describe, it, expect, vi } from 'vitest';
import { AIService } from '../AIService';

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => vi.fn()),
}));

vi.mock('../../../../core/errors/reportError', () => ({
  reportError: vi.fn(),
}));

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
});
