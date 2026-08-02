import { describe, it, expect, vi, beforeEach } from 'vitest';

const savedAs: { blob: unknown; name: string }[] = [];
vi.mock('file-saver', () => ({
  saveAs: (blob: unknown, name: string) => { savedAs.push({ blob, name }); },
}));

import { exportAllAsZip } from '../ExportAllService';
import type { ArchiveSession } from '../../archive/types';

const STRINGS = {
  untitled: 'Без названия', words: 'слов', minutes: 'мин', wpm: 'зн/мин',
} as never;

function note(id: string, content: string): ArchiveSession {
  return {
    id, title: `Заметка ${id}`, content, wordCount: 2, duration: 60, wpm: 2,
    createdAt: new Date('2026-08-02'), versions: [],
  } as never;
}

// H2 сделал загрузку jszip динамической: `await import('jszip')` внутри самой
// функции. Ломается такое молча — сборка и типы остаются зелёными, а архив
// перестаёт собираться только в рантайме. Этот тест вызывает функцию целиком,
// поэтому падает, если импорт не разрешается.
describe('exportAllAsZip', () => {
  beforeEach(() => { savedAs.length = 0; });

  it('builds a zip and hands it to the saver', async () => {
    const res = await exportAllAsZip([note('a', 'первый текст'), note('b', 'второй текст')], STRINGS);

    expect(res).toEqual({ exported: 2, skipped: 0 });
    expect(savedAs).toHaveLength(1);
    expect(savedAs[0]!.name).toMatch(/^justwriting_backup_\d{4}-\d{2}-\d{2}\.zip$/);
    // Не просто «что-то отдали»: zip начинается с сигнатуры PK.
    const bytes = new Uint8Array(await (savedAs[0]!.blob as Blob).arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });

  it('skips a note whose text was never loaded instead of writing it empty', async () => {
    const notLoaded = { ...note('c', ''), _contentNotLoaded: true } as never;

    const res = await exportAllAsZip([note('a', 'текст'), notLoaded], STRINGS);

    expect(res).toEqual({ exported: 1, skipped: 1 });
  });
});
