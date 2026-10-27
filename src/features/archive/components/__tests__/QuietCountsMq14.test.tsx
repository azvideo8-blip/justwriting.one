// MQ-14: нули не пишем — «Корзина 0 · 10 дней» в меню архива и «· 0 мин» в «Инфо» читалки.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/utils/render';
import { LanguageProvider } from '../../../../shared/i18n';
import { ToastProvider } from '../../../../shared/components/Toast';
import { MobileArchiveMenuSheet } from '../MobileArchiveMenuSheet';
import { DocumentPreview } from '../DocumentPreview';
import type { ArchiveSession } from '../../types';

vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'mobile', setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../core/services/StorageService', () => ({
  StorageService: { addLocalCopy: vi.fn(), addCloudCopy: vi.fn(), removeLocalCopy: vi.fn(), removeCloudCopy: vi.fn(), trashDocument: vi.fn() },
}));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { unlinkFromCloud: vi.fn(), clearLocalOnlyForUpload: vi.fn() },
}));

const menu = (trashCount: number) => render(
  <LanguageProvider>
    <MobileArchiveMenuSheet
      open onClose={vi.fn()} viewMode="list" onViewModeChange={vi.fn()} searchVisible={false} onSearchVisibleChange={vi.fn()} sortMode={'newest' as never} onSortModeChange={vi.fn()}
      sortLabels={{} as never} onOpenTags={vi.fn()} onOpenCalendar={vi.fn()} activeTab="notes" onTabChange={vi.fn()}
      trashCount={trashCount} onClearTrash={vi.fn()}
    />
  </LanguageProvider>,
);

describe('MQ-14: меню архива', () => {
  it('пустая корзина — без «0 · 10 дней»', () => {
    menu(0);
    const row = screen.getByRole('button', { name: /Корзина/ });
    expect(row.textContent).not.toMatch(/10 дней|0 ·/);
  });

  it('в корзине 3 — «3 · 10 дней»', () => {
    menu(3);
    expect(screen.getByRole('button', { name: /Корзина/ }).textContent).toContain('3 · 10 дней');
  });
});

describe('MQ-14: «Инфо» читалки', () => {
  const session = (duration: number) => ({
    id: 'd1', userId: 'u1', title: 'Заметка', content: 'Текст.', duration, wordCount: 40, charCount: 200, wpm: 5,
    tags: [], createdAt: new Date(2026, 9, 14, 19, 5).getTime(), _isLocal: true,
  } as unknown as ArchiveSession);

  const open = (duration: number) => {
    renderWithProviders(
      <MemoryRouter><ToastProvider>
        <DocumentPreview
          session={session(duration)} onClose={vi.fn()} onContinue={vi.fn()} onTagsChange={vi.fn()} onLabelChange={vi.fn()} onAddLabel={vi.fn()}
          labels={[]} allTags={[]} onAnalyzeNote={vi.fn()} fetchSummary={vi.fn().mockResolvedValue(null)} fetchRelatedNotes={vi.fn().mockResolvedValue([])}
        />
      </ToastProvider></MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Инфо' }));
    return screen.findByRole('dialog', { name: 'Инфо' });
  };

  it('короткая заметка: «0 мин» не пишем', async () => {
    const dialog = await open(20);
    expect(dialog.textContent).not.toMatch(/\b0 мин/);
    expect(dialog.textContent).toContain('~1 мин чтения');
  });

  it('пять минут — «· 5 мин»', async () => {
    const dialog = await open(300);
    expect(dialog.textContent).toMatch(/· 5 мин/);
  });
});
