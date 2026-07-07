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
    expect(syncOneMock).toHaveBeenCalledWith('user-1', 'local-1');
  });

  it('queues the note for retry if the initial cloud sync fails', async () => {
    syncOneMock.mockRejectedValueOnce(new Error('offline'));
    const file = makeFile('note.txt', 'some content');
    await importNoteFile(file, 'user-1', true);

    // syncOne is fire-and-forget; flush microtasks so its rejection handler runs.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addToQueueMock).toHaveBeenCalledWith('local-1');
  });

  it('does not attempt cloud sync for guests', async () => {
    const file = makeFile('note.txt', 'some content');
    await importNoteFile(file, 'guest-id', false);

    expect(saveNewMock).toHaveBeenCalled();
    expect(syncOneMock).not.toHaveBeenCalled();
  });
});
