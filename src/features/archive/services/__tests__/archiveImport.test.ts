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
});

