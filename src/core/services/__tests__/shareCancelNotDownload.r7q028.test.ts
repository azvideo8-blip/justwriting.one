// R7Q-028: «void fn(); onClose();» в листе выбрасывал промис экспорта, а в
// ArchiveExportService отменённое «Поделиться» проглатывалось и превращалось в
// скачивание файлом. Человек отменил шторку — файл всё равно прилетал в
// «Загрузки».
//
// Мутация: вернуть `isExpectedShareRefusal` как единственное условие (без return
// на AbortError) — красный кейс «отменённое «Поделиться» не скачивает».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportAsMd, isExpectedShareRefusal } from '../ArchiveExportService';
import type { ArchiveSession } from '../../../features/archive/types';

const session = {
  id: 'doc_share_1',
  userId: 'user_1',
  title: 'Тихий вечер',
  content: 'Свет в окне.',
  createdAt: new Date(2026, 9, 1).toISOString(),
  duration: 60,
  wordCount: 3,
  tags: [],
  sittings: [],
} as unknown as ArchiveSession;

const strings = {
  date: 'Дата', words: 'Слов', time: 'Время', tags: 'Теги', untitled: 'Без названия', untitledFilename: 'заметка',
};

let shareImpl: (() => Promise<void>) | null = null;
let clicked: string[] = [];

beforeEach(() => {
  clicked = [];
  Object.defineProperty(window.URL, 'createObjectURL', { value: vi.fn(() => 'blob:fake'), configurable: true });
  Object.defineProperty(window.URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.download);
  });
  Object.defineProperty(navigator, 'share', {
    get: () => (shareImpl === null ? undefined : () => shareImpl!()),
    configurable: true,
  });
  Object.defineProperty(navigator, 'canShare', {
    get: () => (shareImpl === null ? undefined : () => true),
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  shareImpl = null;
});

function refusal(name: string): Error {
  const e = new Error(name) as Error & { name: string };
  e.name = name;
  return e;
}

/** `exportAsMd` возвращает void: ждать надо не его, а макрозадачу, в которой уходит запасное скачивание. */
const flush = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

describe('R7Q-028: отмена «Поделиться» — не скачивание', () => {
  it('человек закрыл шторку (AbortError) — файл не скачивается', async () => {
    shareImpl = () => Promise.reject(refusal('AbortError'));
    exportAsMd(session, strings);
    await flush();
    expect(clicked, 'после отмены шторки ушёл файл в загрузки').toEqual([]);
  });

  it('шторка не разрешена браузером (NotAllowedError) — скачивание остаётся запасным путём', async () => {
    shareImpl = () => Promise.reject(refusal('NotAllowedError'));
    exportAsMd(session, strings);
    await flush();
    expect(clicked.length, 'браузер не дал шторку, и запасного скачивания нет').toBe(1);
  });

  it('успешное «Поделиться» не дублируется скачиванием', async () => {
    shareImpl = () => Promise.resolve();
    exportAsMd(session, strings);
    await flush();
    expect(clicked).toEqual([]);
  });

  it('список ожидаемых отказов не потерял имена', () => {
    // Контроль над тем, что правка не расширила белый список до «любой отказ».
    expect(isExpectedShareRefusal(refusal('NotAllowedError'))).toBe(true);
    expect(isExpectedShareRefusal(refusal('NotSupportedError'))).toBe(true);
    expect(isExpectedShareRefusal(new Error('boom'))).toBe(false);
  });
});
