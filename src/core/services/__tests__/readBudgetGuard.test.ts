import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DocumentService } from '../DocumentService';
import { VersionService } from '../VersionService';
import { ReadBudgetExhaustedError, spendReadBudget } from '../../firebase/readBudget';
import { exportAllAsZip } from '../../../features/export/ExportAllService';
import type { ArchiveSession } from '../../../features/archive/types';

vi.mock('../../firebase/firestoreClient', () => ({
  getClient: vi.fn(async () => { throw new Error('should never reach Firestore in these tests'); }),
}));

vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

// A spent read budget means "could not ask", never "there is nothing there".
// getUserDocuments() resolving to [] on an unavailable read is what marked every
// linked note "Cloud Copy Lost" next to an Unlink button (3b387b25).
describe('read budget exhaustion', () => {
  beforeEach(() => {
    localStorage.clear();
    spendReadBudget(999_999, 'test-exhaust');
  });

  afterEach(() => localStorage.clear());

  it('getUserDocuments throws instead of resolving to an empty list', async () => {
    await expect(DocumentService.getUserDocuments('user_1')).rejects.toBeInstanceOf(ReadBudgetExhaustedError);
  });

  it('getVersions throws instead of resolving to an empty list', async () => {
    await expect(VersionService.getVersions('user_1', 'doc_1')).rejects.toBeInstanceOf(ReadBudgetExhaustedError);
  });

  it('getLatestContent throws instead of resolving to empty text', async () => {
    await expect(VersionService.getLatestContent('user_1', 'doc_1')).rejects.toBeInstanceOf(ReadBudgetExhaustedError);
  });

  it('getLatestVersion throws instead of resolving to null', async () => {
    await expect(VersionService.getLatestVersion('user_1', 'doc_1')).rejects.toBeInstanceOf(ReadBudgetExhaustedError);
  });
});

describe('export never writes an unloaded note as empty', () => {
  const strings = {
    date: 'Дата', words: 'Слов', time: 'Время', tags: 'Теги',
    untitled: 'Без названия', untitledFilename: 'note',
  };

  const session = (over: Partial<ArchiveSession>): ArchiveSession => ({
    id: 'cloud_1',
    userId: 'user_1',
    content: '',
    duration: 0,
    wordCount: 120,
    charCount: 0,
    wpm: 0,
    title: 'Настоящая заметка',
    tags: [],
    createdAt: new Date(),
    ...over,
  } as ArchiveSession);

  it('skips a note whose text was never fetched rather than exporting a blank file', async () => {
    const result = await exportAllAsZip([session({ _contentNotLoaded: true })], strings);
    expect(result).toEqual({ exported: 0, skipped: 1 });
  });

  it('exports it once the text has been loaded', async () => {
    const result = await exportAllAsZip([session({ content: 'настоящий текст' })], strings);
    expect(result).toEqual({ exported: 1, skipped: 0 });
  });
});
