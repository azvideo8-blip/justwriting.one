// MR-10: корзина на телефоне — компактные строки, действия в листе.
// Высоту в jsdom не измерить, поэтому проверяется разметка компактного ряда
// (`h-16` = 64 px при 190 px десктопной карточки) и то, что обеих кнопок в
// списке нет — они внутри листа.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '../../../../shared/i18n';
import { ArchiveTrashView } from '../ArchiveTrashView';
import type { ArchiveSession } from '../../types';

const sessions = [
  {
    id: 'doc_1', userId: 'u1', content: 'Текст удалённой заметки.', title: 'Сожжённый черновик',
    wordCount: 4, sittings: [], tags: [], createdAt: new Date(2025, 8, 1, 9, 5),
    trashedAt: Date.now() - 3 * 24 * 60 * 60 * 1000, _isLocal: true,
  },
] as unknown as ArchiveSession[];

function TrashProbe({ isMobile }: { isMobile: boolean }) {
  const { t, tp } = useLanguage();
  return (
    <ArchiveTrashView
      trashedSessions={sessions}
      onRestore={vi.fn().mockResolvedValue(undefined)}
      onDeletePermanently={vi.fn()}
      onEmptyTrash={vi.fn()}
      onOpenPreview={vi.fn()}
      t={t}
      tp={tp}
      isMobile={isMobile}
    />
  );
}

describe('MR-10: корзина на телефоне', () => {
  beforeEach(() => { cleanup(); });

  it('мобильный ряд компактный: 64 px вместо карточки в 190 px', () => {
    render(<LanguageProvider><TrashProbe isMobile /></LanguageProvider>);
    const row = screen.getByText('Сожжённый черновик').closest('div[class*="h-16"]');
    expect(row, 'компактного ряда нет').not.toBeNull();
    expect(row?.className).toContain('h-16');
  });

  it('в списке нет двух кнопок на каждую запись — они в листе', () => {
    render(<LanguageProvider><TrashProbe isMobile /></LanguageProvider>);
    expect(screen.queryByRole('button', { name: 'Восстановить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удалить навсегда' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Очистить корзину' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Действия с заметкой' }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain('Восстановить');
    expect(sheet.textContent).toContain('Удалить навсегда');
  });

  it('десктоп остаётся карточкой с двумя кнопками', () => {
    render(<LanguageProvider><TrashProbe isMobile={false} /></LanguageProvider>);
    expect(screen.getByRole('button', { name: 'Восстановить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Удалить навсегда' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Очистить корзину' })).toBeTruthy();
    expect(screen.queryByText('Действия с заметкой')).toBeNull();
  });
});
