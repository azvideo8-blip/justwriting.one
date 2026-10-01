import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseImportFile, importNoteFile } from '../archiveImport';

const saveNewMock = vi.fn().mockResolvedValue({ localId: 'local-1' });
const syncOneMock = vi.fn().mockResolvedValue(undefined);
const addToQueueMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../../core/services/LocalStorageService', () => ({
  LocalStorageService: { saveNew: (...args: unknown[]) => saveNewMock(...args) },
}));

vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: {
    syncOne: (...args: unknown[]) => syncOneMock(...args),
    addToQueue: (...args: unknown[]) => addToQueueMock(...args),
  },
}));

function makeFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('parseImportFile', () => {
  it('uses the filename (without extension) as the default title', () => {
    const parsed = parseImportFile('My Note.txt', 'hello world');
    expect(parsed.title).toBe('My Note');
    expect(parsed.content).toBe('hello world');
    expect(parsed.tags).toEqual([]);
    expect(parsed.wordCount).toBe(2);
  });

  it('extracts title and tags from YAML frontmatter', () => {
    const raw = '---\ntitle: "Custom Title"\ntags: [one, two, "three"]\n---\nbody text here';
    const parsed = parseImportFile('file.md', raw);
    expect(parsed.title).toBe('Custom Title');
    expect(parsed.tags).toEqual(['one', 'two', 'three']);
    expect(parsed.content).toBe('body text here');
  });

  it('extracts title, date, mood, and tags from legacy # Title format', () => {
    const raw =
      '# Legacy Title\n\n' +
      '**Дата:** 2026-09-07 | **Слов:** 100\n' +
      '**Теги:** #first #second\n' +
      '**Настроение:** happy\n\n' +
      '---\n\n' +
      'Legacy body text';
    const parsed = parseImportFile('export_2026-09-07_Legacy Title.txt', raw);
    expect(parsed.title).toBe('Legacy Title');
    expect(parsed.tags).toEqual(['first', 'second']);
    expect(parsed.mood).toBe('happy');
    expect(parsed.date).toBe('2026-09-07');
    expect(parsed.content).toBe('Legacy body text');
  });
});

describe('importNoteFile', () => {
  beforeEach(() => {
    saveNewMock.mockClear();
    syncOneMock.mockClear();
    addToQueueMock.mockClear();
  });

  it('rejects unsupported file extensions without saving', async () => {
    const file = makeFile('image.png', 'binary');
    const result = await importNoteFile(file, 'user-1', true);
    expect(result.success).toBe(false);
    expect(saveNewMock).not.toHaveBeenCalled();
  });

  // Regression: imports used to call LocalStorageService.saveNew directly and
  // stop there, bypassing the cloud-sync step every other save path gets from
  // cleanupDraftsAfterSave. Imported notes ended up local-only forever.
  it('syncs the imported note to the cloud for signed-in users', async () => {
    const file = makeFile('note.txt', 'some content');
    const result = await importNoteFile(file, 'user-1', true);

    expect(result.success).toBe(true);
    expect(saveNewMock).toHaveBeenCalledWith('user-1', expect.objectContaining({ title: 'note', content: 'some content' }));
    expect(addToQueueMock).toHaveBeenCalledWith('local-1', 'user-1');
    expect(syncOneMock).toHaveBeenCalledWith('user-1', 'local-1');
  });

  it('queues the note for retry if the initial cloud sync fails', async () => {
    syncOneMock.mockRejectedValueOnce(new Error('offline'));
    const file = makeFile('note.txt', 'some content');
    await importNoteFile(file, 'user-1', true);

    // syncOne is fire-and-forget; flush microtasks so its rejection handler runs.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addToQueueMock).toHaveBeenCalledWith('local-1', 'user-1');
  });

  it('does not attempt cloud sync for guests', async () => {
    const file = makeFile('note.txt', 'some content');
    await importNoteFile(file, 'guest-id', false);

    expect(saveNewMock).toHaveBeenCalled();
    expect(syncOneMock).not.toHaveBeenCalled();
  });

  it('L-1: imports note exported by 0.8.39 with Russian header preserving original date', async () => {
    const legacyExportContent = `# Заголовок заметки

**Дата:** 5 сентября 2026 г.
**Теги:** #мысли
**Слов:** 10 · 1 мин

Текст заметки из старой версии.`;
    const file = makeFile('test-0.8.39.md', legacyExportContent);
    const result = await importNoteFile(file, 'user-1', false);

    expect(result.success).toBe(true);
    expect(result.dateUnreadable).toBeFalsy();

    const savedPayload = saveNewMock.mock.calls[saveNewMock.mock.calls.length - 1]![1];
    expect(savedPayload.sessionStartedAt).toBeInstanceOf(Date);
    expect(savedPayload.sessionStartedAt.getFullYear()).toBe(2026);
    expect(savedPayload.sessionStartedAt.getMonth()).toBe(8); // September is 8 (0-indexed)
    expect(savedPayload.sessionStartedAt.getDate()).toBe(5);
    // D-4: дата файла должна доходить до самого документа, а не только до версии.
    expect(savedPayload.documentDate).toEqual(savedPayload.sessionStartedAt);
  });

  it('L-1: file with genuinely unreadable date imports and reports dateUnreadable', async () => {
    const unreadableDateContent = `# Заголовок

**Дата:** нечитаемая строка даты
**Теги:** #тест

Текст заметки.`;
    const file = makeFile('unreadable-date.md', unreadableDateContent);
    const result = await importNoteFile(file, 'user-1', false);

    expect(result.success).toBe(true);
    expect(result.dateUnreadable).toBe(true);

    const savedPayload = saveNewMock.mock.calls[saveNewMock.mock.calls.length - 1]![1];
    expect(savedPayload.sessionStartedAt).toBeInstanceOf(Date);
  });

  it('S-11: rejects docx bomb exceeding 50MB uncompressed budget without calling saveNew', async () => {
    const JSZip = (await import('jszip')).default;
    const bombZip = new JSZip();
    bombZip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    bombZip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    // 55 MB of repeated text
    const largeBody = 'A'.repeat(55 * 1024 * 1024);
    bombZip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${largeBody}</w:t></w:r></w:p></w:body></w:document>`);

    const buf = await bombZip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    const file = new File([buf], 'bomb.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    let failed = false;
    try {
      const res = await importNoteFile(file, 'user-1', false);
      if (!res.success) failed = true;
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
    expect(saveNewMock).not.toHaveBeenCalled();
  });

  it('S-11: imports normal docx file', async () => {
    const JSZip = (await import('jszip')).default;
    const normalZip = new JSZip();
    normalZip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    normalZip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    normalZip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello normal docx</w:t></w:r></w:p></w:body></w:document>');

    const buf = await normalZip.generateAsync({ type: 'arraybuffer' });
    const file = new File([buf], 'normal.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    const res = await importNoteFile(file, 'user-1', false);
    expect(res.success).toBe(true);
    expect(saveNewMock).toHaveBeenCalled();
  });

  it('clamps tags to <= 10 of <= 50 chars, and title/mood to <= 500 chars (S-19)', async () => {
    const hugeTags = Array.from({ length: 50 }, (_, i) => `tag_${i}_${'a'.repeat(200)}`);
    const hugeTitle = 't'.repeat(3000);
    const hugeMood = 'настроение_'.repeat(150);
    const { serializeNoteMarkdown } = await import('../../../../core/services/noteFormat');
    const content = serializeNoteMarkdown({
      title: hugeTitle,
      tags: hugeTags,
      mood: hugeMood,
      content: 'body text',
    });

    const file = makeFile('huge.md', content);
    const result = await importNoteFile(file, 'user-1', true);
    expect(result.success).toBe(true);

    expect(saveNewMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        title: expect.any(String),
        tags: expect.any(Array),
        mood: expect.any(String),
      }),
    );

    const savedDoc = saveNewMock.mock.calls[0]![1] as { tags: string[]; title: string; mood: string };
    expect(savedDoc.tags.length).toBeLessThanOrEqual(10);
    for (const tag of savedDoc.tags) {
      expect(tag.length).toBeLessThanOrEqual(50);
    }
    expect(savedDoc.title.length).toBeLessThanOrEqual(500);
    expect(savedDoc.mood.length).toBeLessThanOrEqual(500);
  });
});


