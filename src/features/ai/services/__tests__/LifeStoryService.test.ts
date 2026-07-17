import { describe, it, expect } from 'vitest';
import { LifeStoryService } from '../LifeStoryService';

describe('LifeStoryService', () => {
  describe('getDefaultEventDate', () => {
    it('should correctly default to writingDate - 1 day', () => {
      const writingDateStr = '2026-07-17';
      const eventDate = LifeStoryService.getDefaultEventDate(writingDateStr);
      expect(eventDate).toBe('2026-07-16');
    });

    it('should handle month boundaries correctly', () => {
      const writingDateStr = '2026-07-01';
      const eventDate = LifeStoryService.getDefaultEventDate(writingDateStr);
      expect(eventDate).toBe('2026-06-30');
    });

    it('should handle year boundaries correctly', () => {
      const writingDateStr = '2026-01-01';
      const eventDate = LifeStoryService.getDefaultEventDate(writingDateStr);
      expect(eventDate).toBe('2025-12-31');
    });

    it('should fallback to yesterday when date is invalid', () => {
      const invalidDateStr = 'not-a-date';
      const eventDate = LifeStoryService.getDefaultEventDate(invalidDateStr);
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const expected = yesterday.toISOString().slice(0, 10);
      expect(eventDate).toBe(expected);
    });
  });
});
