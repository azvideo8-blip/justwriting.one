// MR-9: строка заметки на телефоне — теги текстом, весь ряд открывает заметку,
// «⋯» 44 px, время в колонке моноширинным. Десктопный ряд остаётся с чипсами.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NoteRow } from '../NoteRow';
import type { ArchiveSession } from '../../types';

let layoutMode: 'desktop' | 'mobile' = 'mobile';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ profile: null, user: null }) }));
vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));

const session = {
  id: 'doc_1', userId: 'u1', content: 'Текст заметки про глину.', duration: 300, wordCount: 4,
  sessionWordsAdded: 4, sittings: [], charCount: 24, wpm: 8, title: 'Гончарный круг',
  tags: ['глина', 'семья'], createdAt: new Date(2025, 8, 1, 9, 33),
  sessionStartTime: new Date(2025, 8, 1, 9, 33).getTime(), _isLocal: true,
} as unknown as ArchiveSession;

const renderRow = (onOpen = vi.fn()) => {
  render(<NoteRow session={session} onOpen={onOpen} t={(k: string) => k} language="ru" userId="user_1" onTagsChange={vi.fn()} onDelete={vi.fn()} />);
  return onOpen;
};

describe('MR-9: мобильный ряд заметки', () => {
  beforeEach(() => { cleanup(); layoutMode = 'mobile'; });

  it('теги — текст, а не кнопки редактирования', () => {
    renderRow();
    expect(screen.getByText('#глина #семья')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /tag/i })).toBeNull();
  });

  it('весь ряд открывает заметку: тап по колонке времени тоже', () => {
    const onOpen = renderRow();
    fireEvent.click(screen.getByText('09:33'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('колонка времени — tabular-nums (не mono), ширина 44 px, а высота ряда — 60 px', () => {
    renderRow();
    const time = screen.getByText('09:33');
    expect(time.className).toContain('tabular-nums');
    expect(time.className).not.toContain('font-mono');
    expect(time.className).toContain('min-w-11');
    const row = time.closest('div[class*="grid-cols"]');
    expect(row?.className).toContain('min-h-[60px]');
  });

  it('«⋯» — цель 44 px, и её тап не открывает заметку', () => {
    const onOpen = renderRow();
    const more = screen.getByRole('button', { name: 'archive_note_actions' });
    expect(more.className).toContain('w-11');
    fireEvent.click(more);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('«Добавить тег» из листа возвращает чипсы: правка тегов остаётся доступной', () => {
    renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'archive_note_actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'archive_add_tag_aria' }));
    // Лист закрылся, ввод тега открылся — чипсы появились только на время ввода.
    expect(screen.getAllByRole('button', { name: 'archive_tag_remove' })).toHaveLength(2);
  });
});

describe('MR-9: десктопный ряд не изменился', () => {
  beforeEach(() => { cleanup(); layoutMode = 'desktop'; });

  it('чипсы тегов и кнопки редактирования на месте, ряд без мобильной высоты', () => {
    const onOpen = renderRow();
    expect(screen.getAllByRole('button', { name: /tag/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText('#глина #семья')).toBeNull();
    const more = screen.getByRole('button', { name: 'archive_note_actions' });
    expect(more.closest('div[class*="grid-cols"]')?.className).not.toContain('min-h-[60px]');
    fireEvent.click(screen.getByText('Гончарный круг'));
    expect(onOpen, 'на десктопе клик по заголовку открыл заметку — поведение изменилось').not.toHaveBeenCalled();
  });
});
