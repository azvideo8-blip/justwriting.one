import { describe, it, expect, vi, beforeEach } from 'vitest';

const savedAs: { blob: unknown; name: string }[] = [];
vi.mock('../../../shared/utils/downloadBlob', () => ({
  downloadBlob: (blob: unknown, name: string) => { savedAs.push({ blob, name }); },
}));

import { exportAllAsZip } from '../../../core/services/ExportAllService';
import type { ArchiveSession } from '../../../shared/types/common';

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

  // D-2, вопрос отчёта: корзина входит в архив и отдельной пометки не получает.
  // Поведение зафиксировано тестом, чтобы его нельзя было изменить молча.
  it('включает заметку из корзины без пометки (ответ для отчёта D-2)', async () => {
    const trashed = { ...note('t', 'текст из корзины'), trashedAt: Date.now() } as never;

    const res = await exportAllAsZip([trashed], STRINGS);

    expect(res).toEqual({ exported: 1, skipped: 0 });
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(savedAs[0]!.blob as Blob);
    const names = Object.keys(zip.files);
    expect(names).toHaveLength(1);
    expect(names[0]).not.toContain('корзин');
  });

  it('skips a note whose text was never loaded instead of writing it empty', async () => {
    const notLoaded = { ...note('c', ''), _contentNotLoaded: true } as never;

    const res = await exportAllAsZip([note('a', 'текст'), notLoaded], STRINGS);

    expect(res).toEqual({ exported: 1, skipped: 1 });
  });
});

// Владелец 30.10: выгрузка «Только с этого устройства» помечена в имени и внутри.
// Мутация: не класть пометку → красный.
describe('exportAllAsZip: пометка выгрузки без облака', () => {
  beforeEach(() => { savedAs.length = 0; });

  it('имя с хвостом и файл-пояснение внутри', async () => {
    await exportAllAsZip([note('a', 'текст')], STRINGS, { suffix: 'только-это-устройство', note: 'Облако было недоступно — здесь только заметки с этого устройства.' });
    expect(savedAs[0]!.name).toMatch(/_только-это-устройство\.zip$/);
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(savedAs[0]!.blob as Blob);
    const notePath = Object.keys(zip.files).find(n => n.includes('только-это-устройство'));
    expect(notePath, 'нет файла-пояснения').toBeDefined();
    expect(await zip.file(notePath!)!.async('string')).toContain('Облако было недоступно');
  });

  it('обычная выгрузка — без хвоста и без пояснения', async () => {
    await exportAllAsZip([note('a', 'текст')], STRINGS);
    expect(savedAs[0]!.name).not.toContain('только');
  });
});
