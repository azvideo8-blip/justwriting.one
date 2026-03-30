import { ExportService } from '../ExportService';
import { describe, it, expect } from 'vitest';

describe('ExportService', () => {
  it('has export methods', () => {
    expect(ExportService.toTxt).toBeDefined();
    expect(ExportService.toPDF).toBeDefined();
    expect(ExportService.toMarkdown).toBeDefined();
    expect(ExportService.toDocx).toBeDefined();
  });
});
