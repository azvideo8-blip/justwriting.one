import { describe, it, expect } from 'vitest';
import { ATTACHED_NOTE_RE, ATTACHED_NOTE_SUMMARY_RE, ATTACHED_FILE_RE } from '../AIChatPresentational';

describe('Attachment Regexes', () => {
  describe('ATTACHED_NOTE_RE', () => {
    it('matches clean note marker', () => {
      const content = '[Прикреплена заметка: "Моя заметка"]\nТекст заметки';
      const match = content.match(ATTACHED_NOTE_RE);
      expect(match).toBeTruthy();
      expect(match![1]).toBe('Моя заметка');
      expect(content.replace(ATTACHED_NOTE_RE, '').trim()).toBe('Текст заметки');
    });

    it('matches note marker with leading citation', () => {
      const content = '[#local_abc · 2026-07-20]\n[Прикреплена заметка: "Моя заметка"]\nТекст заметки';
      const match = content.match(ATTACHED_NOTE_RE);
      expect(match).toBeTruthy();
      expect(match![1]).toBe('Моя заметка');
      expect(content.replace(ATTACHED_NOTE_RE, '').trim()).toBe('Текст заметки');
    });
  });

  describe('ATTACHED_NOTE_SUMMARY_RE', () => {
    it('matches clean summary marker', () => {
      const content = '[Прикреплено саммари заметки: "Саммари"]\nТекст';
      const match = content.match(ATTACHED_NOTE_SUMMARY_RE);
      expect(match).toBeTruthy();
      expect(match![1]).toBe('Саммари');
      expect(content.replace(ATTACHED_NOTE_SUMMARY_RE, '').trim()).toBe('Текст');
    });

    it('matches summary marker with leading citation', () => {
      const content = '[#local_xyz · 2026-07-21]\n[Прикреплено саммари заметки: "Саммари"]\nТекст';
      const match = content.match(ATTACHED_NOTE_SUMMARY_RE);
      expect(match).toBeTruthy();
      expect(match![1]).toBe('Саммари');
      expect(content.replace(ATTACHED_NOTE_SUMMARY_RE, '').trim()).toBe('Текст');
    });
  });

  describe('ATTACHED_FILE_RE', () => {
    it('matches clean file marker', () => {
      const content = '[Прикреплен файл: "data.csv"]\nСодержимое';
      const match = content.match(ATTACHED_FILE_RE);
      expect(match).toBeTruthy();
      expect(match![1]).toBe('data.csv');
      expect(content.replace(ATTACHED_FILE_RE, '').trim()).toBe('Содержимое');
    });

    it('matches file marker with leading citation', () => {
      const content = '[#local_123 · 2026-07-22]\n[Прикреплен файл: "data.csv"]\nСодержимое';
      const match = content.match(ATTACHED_FILE_RE);
      expect(match).toBeTruthy();
      expect(match![1]).toBe('data.csv');
      expect(content.replace(ATTACHED_FILE_RE, '').trim()).toBe('Содержимое');
    });
  });
});
