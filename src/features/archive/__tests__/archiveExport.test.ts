import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportAsMd, ExportStrings } from '../services/ArchiveExportService';
import type { ArchiveSession } from '../types';
import type { Session } from '../../../types/index';

// ─── Mock downloadBlob (DOM-based helper) via URL/anchor mocking ──────────────

// We'll capture what was passed to Blob to inspect the output.
let capturedContent = '';
let capturedFilename = '';

beforeEach(() => {
  capturedContent = '';
  capturedFilename = '';

  // Mock URL.createObjectURL and revokeObjectURL
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  });

  // Mock document.createElement, body.appendChild, body.removeChild
  const anchor = {
    href: '',
    download: '',
    click: vi.fn(),
  };
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'a') return anchor as unknown as HTMLAnchorElement;
    return document.createElement(tag);
  });
  vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
    if ((node as HTMLAnchorElement).download !== undefined) {
      capturedFilename = (node as HTMLAnchorElement).download;
    }
    return node;
  });
  vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

  // Override Blob to capture content
  const OriginalBlob = globalThis.Blob;
  vi.stubGlobal('Blob', class MockBlob extends OriginalBlob {
    constructor(parts: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options);
      capturedContent = (parts as string[]).join('');
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STRINGS: ExportStrings = {
  date: 'Date',
  words: 'words',
  time: 'min',
  tags: 'Tags',
  untitled: 'Untitled',
  untitledFilename: 'untitled',
};

function makeSession(overrides: Partial<ArchiveSession> = {}): ArchiveSession {
  const base: Session = {
    id: 'sess1',
    userId: 'u1',
    authorName: 'Tester',
    authorPhoto: '',
    content: 'Hello world content',
    duration: 300, // 5 minutes
    wordCount: 42,
    charCount: 100,
    wpm: 50,
    createdAt: new Date('2024-01-15'),
    ...overrides,
  };
  return base as ArchiveSession;
}

// ─── exportAsMd ──────────────────────────────────────────────────────────────

describe('exportAsMd', () => {
  it('output starts with # Title', () => {
    exportAsMd(makeSession({ title: 'My Story' }), STRINGS);
    expect(capturedContent).toMatch(/^# My Story/);
  });

  it('uses untitled fallback when title is missing', () => {
    exportAsMd(makeSession({ title: undefined }), STRINGS);
    expect(capturedContent).toMatch(/^# Untitled/);
  });

  it('contains word count line', () => {
    exportAsMd(makeSession({ wordCount: 42 }), STRINGS);
    expect(capturedContent).toContain('42');
  });

  it('contains session content after ---', () => {
    exportAsMd(makeSession({ content: 'Hello world content' }), STRINGS);
    expect(capturedContent).toContain('---');
    const parts = capturedContent.split('---');
    // Content should appear after the --- separator
    expect(parts.slice(1).join('---')).toContain('Hello world content');
  });

  it('contains duration in minutes', () => {
    // 300s = 5 min
    exportAsMd(makeSession({ duration: 300 }), STRINGS);
    expect(capturedContent).toContain('5');
  });

  it('includes tags formatted as #tag', () => {
    exportAsMd(makeSession({ tags: ['fiction', 'draft'] }), STRINGS);
    expect(capturedContent).toContain('#fiction');
    expect(capturedContent).toContain('#draft');
  });

  it('omits tags line when no tags', () => {
    exportAsMd(makeSession({ tags: [] }), STRINGS);
    // The tags line with bold "Tags:" should not appear
    expect(capturedContent).not.toContain(`**${STRINGS.tags}:**`);
  });

  it('filename uses title with .md extension', () => {
    exportAsMd(makeSession({ title: 'My Story' }), STRINGS);
    expect(capturedFilename).toMatch(/My Story.*\.md$/);
  });

  it('filename uses untitledFilename when title is missing', () => {
    exportAsMd(makeSession({ title: undefined }), STRINGS);
    expect(capturedFilename).toMatch(/untitled.*\.md$/);
  });

  it('contains formatted date', () => {
    exportAsMd(makeSession({ createdAt: new Date('2024-01-15') }), STRINGS);
    // Date should contain year 2024
    expect(capturedContent).toContain('2024');
  });
});
