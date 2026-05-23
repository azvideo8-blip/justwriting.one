import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExportService } from '../ExportService';
import { saveAs } from 'file-saver';

vi.mock('file-saver', () => ({
  saveAs: vi.fn(),
}));

vi.mock('docx', () => ({
  Document: vi.fn(),
  Packer: {
    toBlob: vi.fn().mockResolvedValue(new Blob(['mocked docx'], { type: 'docx' })),
  },
  Paragraph: vi.fn(),
  TextRun: vi.fn(),
}));

const originalCreateElement = document.createElement;

describe('ExportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
    global.URL.revokeObjectURL = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('toTxt', () => {
    it('creates an anchor, sets correct attributes, triggers click, and cleans up', () => {
      const clickSpy = vi.fn();
      const appendChildSpy = vi.spyOn(document.body, 'appendChild');
      const removeChildSpy = vi.spyOn(document.body, 'removeChild');

      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const el = originalCreateElement.call(document, tagName);
        if (tagName === 'a') {
          vi.spyOn(el as HTMLElement, 'click').mockImplementation(clickSpy);
        }
        return el;
      });

      const testDate = new Date(2026, 4, 23); // May 23, 2026
      ExportService.toTxt('My Title', 'Test plain text content', testDate);

      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(appendChildSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();

      // Fast-forward timers to check revokeObjectURL
      vi.advanceTimersByTime(150);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });

    it('handles empty title', () => {
      let anchorElement: any = null;
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const el = originalCreateElement.call(document, tagName);
        if (tagName === 'a') {
          anchorElement = el;
          vi.spyOn(el as HTMLElement, 'click').mockImplementation(() => {});
        }
        return el;
      });

      const testDate = new Date(2026, 4, 23);
      ExportService.toTxt('', 'Some content', testDate);
      expect(anchorElement.download).toBe('session_2026-05-23.txt');
    });
  });

  describe('toMarkdown', () => {
    it('starts with # title and saves via file-saver', () => {
      ExportService.toMarkdown('My Markdown Title', 'Some MD content');

      expect(saveAs).toHaveBeenCalled();
      const [blob, filename] = vi.mocked(saveAs).mock.calls[0];
      expect(filename).toBe('My Markdown Title.md');
      expect(blob).toBeInstanceOf(Blob);
    });

    it('handles empty title', () => {
      ExportService.toMarkdown('', 'Some MD content');
      const [, filename] = vi.mocked(saveAs).mock.calls[0];
      expect(filename).toBe('session.md');
    });
  });

  describe('toDocx', () => {
    it('generates a valid docx blob and saves', async () => {
      await ExportService.toDocx('My Docx Title', 'Hello Word document');
      
      expect(saveAs).toHaveBeenCalled();
      const [blob, filename] = vi.mocked(saveAs).mock.calls[0];
      expect(filename).toBe('My Docx Title.docx');
      expect(blob).toBeInstanceOf(Blob);
    });

    it('handles empty title', async () => {
      await ExportService.toDocx('', 'Hello Word document');
      const [, filename] = vi.mocked(saveAs).mock.calls[0];
      expect(filename).toBe('session.docx');
    });
  });

  describe('toPDF', () => {
    it('creates iframe, writes HTML print layout, triggers print, and cleans up', () => {
      const printSpy = vi.fn();
      const appendChildSpy = vi.spyOn(document.body, 'appendChild');
      const removeChildSpy = vi.spyOn(document.body, 'removeChild');

      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const el = originalCreateElement.call(document, tagName);
        if (tagName === 'iframe') {
          Object.defineProperty(el, 'contentWindow', {
            value: {
              focus: vi.fn(),
              print: printSpy,
              document: {
                open: vi.fn(),
                write: vi.fn(),
                close: vi.fn(),
              },
            },
            writable: true,
          });
        }
        return el;
      });

      ExportService.toPDF('My PDF Document', 'This is content to print');

      expect(appendChildSpy).toHaveBeenCalled();
      expect(printSpy).toHaveBeenCalled();

      // Clean up timer checks
      vi.advanceTimersByTime(1500);
      expect(removeChildSpy).toHaveBeenCalled();
    });
  });
});
