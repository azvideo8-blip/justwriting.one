import { describe, it, expect } from 'vitest';
import { serializeNoteMarkdown, parseNoteMarkdown, parseLocalizedDate } from '../noteFormat';

describe('E-5: noteFormat serialization and parsing', () => {
  describe('serializeNoteMarkdown', () => {
    it('serializes note into YAML front matter and content', () => {
      const output = serializeNoteMarkdown({
        title: 'My Title',
        date: new Date('2026-09-07T12:00:00.000Z'),
        tags: ['work', 'journal'],
        mood: 'calm',
        content: 'This is the note content.\nWith multiple lines.',
      });

      expect(output).toBe(
        '---\n' +
        'title: "My Title"\n' +
        'date: "2026-09-07T12:00:00.000Z"\n' +
        'tags: ["work", "journal"]\n' +
        'mood: "calm"\n' +
        '---\n\n' +
        'This is the note content.\nWith multiple lines.'
      );
    });

    it('handles minimal fields with empty tags and mood omitted', () => {
      const output = serializeNoteMarkdown({
        title: 'Minimal',
        content: 'Just content',
      });

      expect(output).toBe(
        '---\n' +
        'title: "Minimal"\n' +
        '---\n\n' +
        'Just content'
      );
    });
  });

  describe('parseNoteMarkdown with YAML front matter', () => {
    it('parses standard YAML front matter output', () => {
      const raw =
        '---\n' +
        'title: "My Title"\n' +
        'date: "2026-09-07T12:00:00.000Z"\n' +
        'tags: ["work", "journal"]\n' +
        'mood: "calm"\n' +
        '---\n\n' +
        'This is the note content.';

      const parsed = parseNoteMarkdown(raw);
      expect(parsed.title).toBe('My Title');
      expect(parsed.date).toBe('2026-09-07T12:00:00.000Z');
      expect(parsed.tags).toEqual(['work', 'journal']);
      expect(parsed.mood).toBe('calm');
      expect(parsed.content).toBe('This is the note content.');
    });

    it('parses unquoted values and list-based tags', () => {
      const raw =
        '---\n' +
        'title: Unquoted Title\n' +
        'tags:\n' +
        '  - tag1\n' +
        '  - tag2\n' +
        '---\n' +
        'Body here';

      const parsed = parseNoteMarkdown(raw);
      expect(parsed.title).toBe('Unquoted Title');
      expect(parsed.tags).toEqual(['tag1', 'tag2']);
      expect(parsed.content).toBe('Body here');
    });

    it('round-trips correctly through serialize and parse', () => {
      const original = {
        title: 'Round Trip Note',
        date: '2026-09-07T12:00:00.000Z',
        tags: ['alpha', 'beta'],
        mood: 'energized',
        content: 'Line 1\n\nLine 2',
      };

      const serialized = serializeNoteMarkdown(original);
      const parsed = parseNoteMarkdown(serialized);

      expect(parsed.title).toBe(original.title);
      expect(parsed.date).toBe(original.date);
      expect(parsed.tags).toEqual(original.tags);
      expect(parsed.mood).toBe(original.mood);
      expect(parsed.content).toBe(original.content);
    });
  });

  describe('parseNoteMarkdown with legacy headers', () => {
    it('parses 0.8.x header with date, tags, and separator', () => {
      const raw =
        '# Legacy Note\n\n' +
        '**Дата:** 7 сентября 2026 г.  \n' +
        '**Слов:** 42  \n' +
        '**Время:** 5 мин  \n' +
        '**Теги:** #work #journal\n' +
        '**Настроение:** calm\n\n' +
        '---\n\n' +
        'Note body text starts here.';

      const parsed = parseNoteMarkdown(raw, 'fallback');
      expect(parsed.title).toBe('Legacy Note');
      expect(parsed.date).toBe('7 сентября 2026 г.');
      expect(parsed.tags).toEqual(['work', 'journal']);
      expect(parsed.mood).toBe('calm');
      expect(parsed.content).toBe('Note body text starts here.');
    });

    it('parses legacy header without separator ---', () => {
      const raw =
        '# Another Note\n\n' +
        '**Date:** 2026-09-07 | **Words:** 120\n\n' +
        'Direct body without horizontal rule.';

      const parsed = parseNoteMarkdown(raw);
      expect(parsed.title).toBe('Another Note');
      expect(parsed.date).toBe('2026-09-07');
      expect(parsed.content).toBe('Direct body without horizontal rule.');
    });
  });

  describe('parseNoteMarkdown with plain text', () => {
    it('uses fallbackTitle for raw text without front matter or header', () => {
      const raw = 'Just a simple text file with no metadata.';
      const parsed = parseNoteMarkdown(raw, 'Default Title');
      expect(parsed.title).toBe('Default Title');
      expect(parsed.content).toBe('Just a simple text file with no metadata.');
      expect(parsed.tags).toEqual([]);
    });
  });

  describe('parseLocalizedDate', () => {
    it('parses Russian long date with г.', () => {
      const d = parseLocalizedDate('14 августа 2024 г.');
      expect(d).not.toBeNull();
      expect(d?.getFullYear()).toBe(2024);
      expect(d?.getMonth()).toBe(7); // August = 7
      expect(d?.getDate()).toBe(14);
    });

    it('parses Russian long date with г', () => {
      const d = parseLocalizedDate('5 сентября 2026 г');
      expect(d).not.toBeNull();
      expect(d?.getFullYear()).toBe(2026);
      expect(d?.getMonth()).toBe(8); // September = 8
      expect(d?.getDate()).toBe(5);
    });

    it('parses English US long date', () => {
      const d = parseLocalizedDate('August 14, 2024');
      expect(d).not.toBeNull();
      expect(d?.getFullYear()).toBe(2024);
      expect(d?.getMonth()).toBe(7);
      expect(d?.getDate()).toBe(14);
    });

    it('parses English GB long date', () => {
      const d = parseLocalizedDate('14 August 2024');
      expect(d).not.toBeNull();
      expect(d?.getFullYear()).toBe(2024);
      expect(d?.getMonth()).toBe(7);
      expect(d?.getDate()).toBe(14);
    });

    it('parses ISO date', () => {
      const d = parseLocalizedDate('2026-09-07T14:30:00.000Z');
      expect(d).not.toBeNull();
      expect(d?.toISOString()).toBe('2026-09-07T14:30:00.000Z');
    });

    it('returns null for unparseable garbage', () => {
      expect(parseLocalizedDate('not a date')).toBeNull();
      expect(parseLocalizedDate('')).toBeNull();
    });
  });
});

