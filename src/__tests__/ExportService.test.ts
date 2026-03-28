import { ExportService } from '../features/export/ExportService';
import { describe, it, expect } from 'vitest';

describe('ExportService', () => {
  it('formats text correctly', () => {
    const text = 'Hello World';
    const formatted = ExportService.formatText(text);
    expect(formatted).toBe('Hello World');
  });

  it('handles empty input', () => {
    const text = '';
    const formatted = ExportService.formatText(text);
    expect(formatted).toBe('');
  });

  it('handles massive input', () => {
    const text = 'a'.repeat(100000);
    const formatted = ExportService.formatText(text);
    expect(formatted.length).toBe(100000);
  });
});
