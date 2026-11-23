import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportAsTxt, exportAsMd, type ExportStrings } from '../ArchiveExportService';
import type { ArchiveSession } from '../../../shared/types/common';

// NB-11 (sus13): exportAsTxt/exportAsMd глотали отказ downloadBlob через void —
// файл не создался, а вызывающий считал экспорт успешным. Отказ должен пробрасываться.
const session = {
  id: 's1', userId: 'user_1', title: 'Синтетическая заметка', content: 'Синтетический текст.',
  wordCount: 2, duration: 60, tags: [], createdAt: new Date(1700000000000),
} as unknown as ArchiveSession;

const strings: ExportStrings = {
  date: 'Дата', words: 'слов', time: 'мин', tags: 'Теги',
  untitled: 'Без названия', untitledFilename: 'note',
};

const createObjectURL = vi.fn(() => 'blob:synthetic');
const revokeObjectURL = vi.fn();

describe('sus13: отказ создания файла пробрасывается из экспорта', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createObjectURL.mockReturnValue('blob:synthetic');
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('exportAsTxt: URL.createObjectURL бросает → промис отклонён', async () => {
    createObjectURL.mockImplementation(() => { throw new Error('SYNTHETIC_QUOTA'); });

    await expect(exportAsTxt(session, strings)).rejects.toThrow('SYNTHETIC_QUOTA');
  });

  it('exportAsMd: URL.createObjectURL бросает → промис отклонён', async () => {
    createObjectURL.mockImplementation(() => { throw new Error('SYNTHETIC_QUOTA'); });

    await expect(exportAsMd(session, strings)).rejects.toThrow('SYNTHETIC_QUOTA');
  });

  it('контроль: файл создан — клик по ссылке, промис исполнен', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await expect(exportAsTxt(session, strings)).resolves.toBeUndefined();
    expect(click).toHaveBeenCalled();
  });
});