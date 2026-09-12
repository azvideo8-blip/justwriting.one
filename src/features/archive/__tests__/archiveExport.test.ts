import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportAsMd, isExpectedShareRefusal, stripMarkdown, ExportStrings, isExportable } from '../../../core/services/ArchiveExportService';
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
    constructor(parts: ConstructorParameters<typeof Blob>[0], options?: ConstructorParameters<typeof Blob>[1]) {
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
    content: 'Hello world content',
    duration: 300,
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
  it('output starts with front matter fence and title', () => {
    exportAsMd(makeSession({ title: 'My Story' }), STRINGS);
    expect(capturedContent).toMatch(/^---\r?\ntitle: "My Story"/);
  });

  it('uses untitled fallback when title is missing', () => {
    exportAsMd(makeSession({ title: undefined }), STRINGS);
    expect(capturedContent).toMatch(/^---\r?\ntitle: "Untitled"/);
  });

  it('contains session content after closing --- fence', () => {
    exportAsMd(makeSession({ content: 'Hello world content' }), STRINGS);
    expect(capturedContent).toContain('---');
    const parts = capturedContent.split('---');
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts.slice(2).join('---')).toContain('Hello world content');
  });

  it('includes tags in front matter', () => {
    exportAsMd(makeSession({ tags: ['fiction', 'draft'] }), STRINGS);
    expect(capturedContent).toContain('tags: ["fiction", "draft"]');
  });

  it('omits tags line when no tags', () => {
    exportAsMd(makeSession({ tags: [] }), STRINGS);
    expect(capturedContent).not.toContain('tags:');
  });

  it('filename uses title with .md extension', () => {
    exportAsMd(makeSession({ title: 'My Story' }), STRINGS);
    expect(capturedFilename).toMatch(/My Story.*\.md$/);
  });

  it('filename uses untitledFilename when title is missing', () => {
    exportAsMd(makeSession({ title: undefined }), STRINGS);
    expect(capturedFilename).toMatch(/untitled.*\.md$/);
  });

  it('contains formatted date in front matter', () => {
    exportAsMd(makeSession({ createdAt: new Date('2024-01-15') }), STRINGS);
    expect(capturedContent).toContain('2024-01-15');
  });
});

// Баг из журнала: сохранение заметки в .txt срабатывало, файл появлялся, но в
// журнале каждый раз писалось «ERROR archive_export_share: Permission denied».
// navigator.canShare({files}) на десктопе отвечает «да», а navigator.share()
// потом отказывает — дальше отрабатывает обычная загрузка, то есть экспорт
// УДАЛСЯ. Ложная ошибка в журнале хуже отсутствия записи: рядом с привычной
// неправдой перестают читать настоящие.
// Фальсификация: убрать любое имя из isExpectedShareRefusal — тест краснеет.
describe('отказ Web Share — ожидаемый исход, а не ошибка', () => {
  const named = (name: string) => Object.assign(new Error('Permission denied'), { name });

  it.each([
    ['NotAllowedError', 'браузер отказал: нет жеста или десктоп'],
    ['AbortError', 'человек закрыл системную шторку'],
    ['NotSupportedError', 'тип файла не шарится'],
    ['SecurityError', 'небезопасный контекст'],
  ])('%s не считается ошибкой (%s)', (name) => {
    expect(isExpectedShareRefusal(named(name))).toBe(true);
  });

  it.each(['TypeError', 'RangeError', 'Error'])('%s остаётся настоящей ошибкой', (name) => {
    expect(isExpectedShareRefusal(named(name))).toBe(false);
  });

  it('не падает на мусоре вместо ошибки', () => {
    expect(isExpectedShareRefusal(null)).toBe(false);
    expect(isExpectedShareRefusal(undefined)).toBe(false);
    expect(isExpectedShareRefusal('Permission denied')).toBe(false);
  });
});

describe('stripMarkdown', () => {
  it('preserves front matter fences and key-value lines while stripping markdown from body', () => {
    const md =
      '---\n' +
      'title: "My Story"\n' +
      'date: "2024-01-15T00:00:00.000Z"\n' +
      'tags: ["work"]\n' +
      '---\n\n' +
      '# My Header\n\n' +
      'This is **bold** and *italic* with a [link](https://example.com).\n\n' +
      '---\n\n' +
      '> A quote block';

    const result = stripMarkdown(md);
    // Front matter fences preserved
    expect(result).toMatch(/^---\r?\ntitle: "My Story"\r?\ndate: "2024-01-15T00:00:00.000Z"\r?\ntags: \["work"\]\r?\n---/);
    // Markdown from body stripped
    expect(result).not.toContain('# My Header');
    expect(result).toContain('My Header');
    expect(result).toContain('bold and italic with a link');
    expect(result).not.toContain('> A quote');
    expect(result).toContain('A quote block');
  });

  it('strips markdown from plain text without front matter', () => {
    const md = '# Header\n**bold**';
    expect(stripMarkdown(md)).toBe('Header\nbold');
  });
});

describe('isExportable (S-6)', () => {
  const plainSession: ArchiveSession = {
    id: 's1',
    userId: 'u1',
    title: 'Plain Note',
    content: 'Some plain content',
    createdAt: Date.now(),
    duration: 60,
    wordCount: 3,
    charCount: 18,
    wpm: 3,
    tags: [],
    _isLocal: true,
  };

  it('allows plain session to be exported', () => {
    expect(isExportable(plainSession)).toBe(true);
  });

  it('rejects unloaded session (_contentNotLoaded: true)', () => {
    expect(isExportable({ ...plainSession, _contentNotLoaded: true })).toBe(false);
  });

  it('rejects locked session (_locked: true)', () => {
    expect(isExportable({ ...plainSession, _locked: true })).toBe(false);
  });

  it('rejects decryption error session (_decryptionError: true)', () => {
    expect(isExportable({ ...plainSession, _decryptionError: true })).toBe(false);
  });
});

