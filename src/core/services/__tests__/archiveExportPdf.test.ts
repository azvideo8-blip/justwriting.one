import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportAsPdf } from '../ArchiveExportService';
import type { ArchiveSession } from '../../../types';

describe('D-27: exportAsPdf window.open popup behavior', () => {
  const dummySession: ArchiveSession = {
    id: 's1',
    userId: 'u1',
    charCount: 26,
    title: 'Тестовая заметка',
    content: 'Текст заметки для экспорта',
    duration: 120,
    wordCount: 4,
    wpm: 2,
    createdAt: 1700000000000,
  };

  const dummyStrings = {
    date: 'Дата',
    words: 'слов',
    time: 'мин',
    tags: 'Теги',
    untitled: 'Без названия',
    untitledFilename: 'bez-nazvaniya',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens window without "noopener" in features and sets opener = null manually without downloading fallback html', () => {
    const listeners: Record<string, () => void> = {};
    const mockWindow = {
      focus: vi.fn(),
      print: vi.fn(),
      opener: 'not-null',
      addEventListener: vi.fn((type: string, cb: () => void) => { listeners[type] = cb; }),
    };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    exportAsPdf(dummySession, dummyStrings);

    expect(openSpy).toHaveBeenCalledTimes(1);
    // Crucial check: window.open was called with '_blank' and NOT 'noopener,noreferrer'
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('blob:'), '_blank');
    expect(mockWindow.opener).toBeNull();
    expect(mockWindow.focus).toHaveBeenCalled();

    // Fallback html download must NOT trigger an anchor click
    expect(clickSpy).not.toHaveBeenCalled();

    // N-16: печать запускается открывшей страницей после загрузки, без инлайн-скрипта (его режет CSP).
    listeners.load?.();
    expect(mockWindow.print).toHaveBeenCalled();
  });

  it('falls back to downloading html if window.open returns null (blocked popup)', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    exportAsPdf(dummySession, dummyStrings);

    expect(clickSpy).toHaveBeenCalled();
  });
});
