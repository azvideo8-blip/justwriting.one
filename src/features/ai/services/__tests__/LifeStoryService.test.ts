import { describe, it, expect } from 'vitest';
import { LifeStoryService } from '../LifeStoryService';

describe('LifeStoryService', () => {
  describe('getDefaultEventDate', () => {
    it('should default to writingDate as-is', () => {
      const writingDateStr = '2026-07-17';
      const eventDate = LifeStoryService.getDefaultEventDate(writingDateStr);
      expect(eventDate).toBe('2026-07-17');
    });

    it('should preserve month boundaries correctly', () => {
      const writingDateStr = '2026-07-01';
      const eventDate = LifeStoryService.getDefaultEventDate(writingDateStr);
      expect(eventDate).toBe('2026-07-01');
    });

    it('should preserve year boundaries correctly', () => {
      const writingDateStr = '2026-01-01';
      const eventDate = LifeStoryService.getDefaultEventDate(writingDateStr);
      expect(eventDate).toBe('2026-01-01');
    });

    it('should fallback to current date when date is invalid', () => {
      const invalidDateStr = 'not-a-date';
      const eventDate = LifeStoryService.getDefaultEventDate(invalidDateStr);
      // Местный день, не UTC: с полуночи до 05:00 (UTC+5) они расходятся, и
      // тест падал по ночам при любом коде.
      const n = new Date();
      const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
      expect(eventDate).toBe(today);
    });
  });
});
