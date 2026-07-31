import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseMonthYear,
  extractFirstSeenDates,
  sanitizeFirstSeenDates,
  getStrippedDatesCount,
  resetStrippedDatesCount,
} from '../dateGuard';

describe('AG-MIND-W8a dateGuard', () => {
  beforeEach(() => {
    resetStrippedDatesCount();
  });

  describe('Cyrillic-safe boundary guard (AG-SEARCH-3)', () => {
    it('fails if \b is used next to Cyrillic characters in dateGuard.ts', () => {
      const filePath = path.resolve(__dirname, '../dateGuard.ts');
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // Look for \b adjacent to Cyrillic characters in the file content
      expect(content).not.toMatch(/\\b[а-яёА-ЯЁ]/);
      expect(content).not.toMatch(/[а-яёА-ЯЁ]\\b/);
    });

    it('fails if \b is used next to Cyrillic characters in aiChatTransport.ts', () => {
      const filePath = path.resolve(__dirname, '../aiChatTransport.ts');
      const content = fs.readFileSync(filePath, 'utf-8');
      
      expect(content).not.toMatch(/\\b[а-яёА-ЯЁ]/);
      expect(content).not.toMatch(/[а-яёА-ЯЁ]\\b/);
    });
  });

  describe('parseMonthYear', () => {
    it('parses ISO date strings', () => {
      expect(parseMonthYear('2026-07-12')).toEqual({ year: 2026, month: 7 });
      expect(parseMonthYear('2025-11-03')).toEqual({ year: 2025, month: 11 });
      expect(parseMonthYear('2026-07')).toEqual({ year: 2026, month: 7 });
    });

    it('parses numeric DD.MM.YYYY strings', () => {
      expect(parseMonthYear('12.07.2026')).toEqual({ year: 2026, month: 7 });
      expect(parseMonthYear('05.11.2025')).toEqual({ year: 2025, month: 11 });
    });

    it('parses Russian month name strings', () => {
      expect(parseMonthYear('12 июля 2026 года')).toEqual({ year: 2026, month: 7 });
      expect(parseMonthYear('в июле 2026 года')).toEqual({ year: 2026, month: 7 });
      expect(parseMonthYear('10 мая 2025 г.')).toEqual({ year: 2025, month: 5 });
      expect(parseMonthYear('в марте 2024')).toEqual({ year: 2024, month: 3 });
    });

    it('returns null for invalid dates', () => {
      expect(parseMonthYear('not a date')).toBeNull();
      expect(parseMonthYear('')).toBeNull();
    });
  });

  describe('extractFirstSeenDates', () => {
    it('extracts ISO dates from lines containing "впервые"', () => {
      const text = `
[Прикреплённая заметка]
Эту мысль («выгорание») ты впервые записал 2026-07-12
Заметка 1: "Проект"
- 2026-05-01: Создана заметка
      `;
      const dates = extractFirstSeenDates(text);
      expect(dates).toEqual(['2026-07-12']);
    });

    it('returns empty array when no first-seen lines exist', () => {
      const text = 'Заметка от 2026-07-12 без каких-либо упоминаний.';
      expect(extractFirstSeenDates(text)).toEqual([]);
    });
  });

  describe('sanitizeFirstSeenDates', () => {
    it('leaves valid injected first-seen date untouched in natural Russian forms', () => {
      const allowed = ['2026-07-12'];

      // ISO form
      const isoText = 'Эту мысль («выгорание») ты впервые записал 2026-07-12.';
      expect(sanitizeFirstSeenDates(isoText, allowed)).toBe(isoText);

      // Full Russian date
      const ruDateText = 'Эту мысль («выгорание») ты впервые записал 12 июля 2026 года.';
      expect(sanitizeFirstSeenDates(ruDateText, allowed)).toBe(ruDateText);

      // Month + year form
      const monthYearText = 'Впервые эта тема появилась в июле 2026 года.';
      expect(sanitizeFirstSeenDates(monthYearText, allowed)).toBe(monthYearText);
    });

    it('strips date from first-seen claim when date was NOT injected', () => {
      const allowed = ['2025-05-10']; // Only May 2025 is allowed
      const text = 'Эту мысль («выгорание») ты впервые записал 12 июля 2026 года.';

      const sanitized = sanitizeFirstSeenDates(text, allowed);
      expect(sanitized).toBe('Эту мысль («выгорание») ты впервые записал.');
      expect(getStrippedDatesCount()).toBe(1);
    });

    it('strips first-seen date when allowed set is empty', () => {
      const allowed: string[] = [];
      const text = 'Ты впервые связал эти понятия 12.07.2026 в контексте работы.';

      const sanitized = sanitizeFirstSeenDates(text, allowed);
      expect(sanitized).toBe('Ты впервые связал эти понятия в контексте работы.');
      expect(getStrippedDatesCount()).toBe(1);
    });

    it('NEVER touches dates in ordinary prose or quoted note text', () => {
      const allowed: string[] = [];
      const ordinaryText = 'В заметке от 12 июля 2026 года [#doc1] ты писал об аскезе. До 2026-07-12 оставалось 3 дня.';

      expect(sanitizeFirstSeenDates(ordinaryText, allowed)).toBe(ordinaryText);
      expect(getStrippedDatesCount()).toBe(0);
    });

    it('safely handles partial streaming chunks without corrupting text', () => {
      const allowed = ['2026-07-12'];
      const partialChunk = 'Ты впервые записал 12 ию';

      expect(sanitizeFirstSeenDates(partialChunk, allowed)).toBe(partialChunk);
    });
  });
});
