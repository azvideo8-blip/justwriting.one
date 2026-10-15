// MF-8: в шапке «Заметок» на телефоне было «записей» без числа; панель тегов из
// «⋯» нельзя было закрыть; строка тегов называлась «ТЕГИ/МЕТКИ» при отдельной
// строке меток.
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../../../shared/i18n';
import { MobileArchiveHeader } from '../MobileArchiveHeader';
import { MobileArchiveMenuSheet } from '../MobileArchiveMenuSheet';
import { MobileInlinePanel } from '../MobileInlinePanel';
import { ArchiveTagBar } from '../ArchiveTagBar';

const wrap = (ui: ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>);

describe('MF-8: Notes header and tags panel', () => {
  it('57 sessions → the header reads «57 записей»', () => {
    wrap(<MobileArchiveHeader title="Заметки" count={57} countLabel="записей" searchQuery="" searchInputRef={{ current: null }}
      onSearchChange={vi.fn()} onOpenMenu={vi.fn()} allTags={[]} selectedTags={[]} onToggleTag={vi.fn()} />);
    expect(screen.getByText('57 записей')).toBeInTheDocument();
  });

  it('the panel has a 44 px × that closes it', () => {
    const onClose = vi.fn();
    wrap(<MobileInlinePanel testId="p" onClose={onClose}><span>{'теги'}</span></MobileInlinePanel>);
    const x = screen.getByRole('button', { name: 'Закрыть' });
    expect(x.className).toContain('h-11');
    expect(x.className).toContain('w-11');
    fireEvent.click(x);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the menu item toggles: «Теги и метки» → «Скрыть теги»', () => {
    const base = {
      open: true, onClose: vi.fn(), viewMode: 'list' as const, onViewModeChange: vi.fn(), sortMode: 'newest' as never,
      onSortModeChange: vi.fn(), sortLabels: {} as never, onOpenCalendar: vi.fn(), activeTab: 'notes' as const,
      onTabChange: vi.fn(), trashCount: 0, onClearTrash: vi.fn(),
    };
    const onOpenTags = vi.fn();
    const { unmount } = wrap(<MobileArchiveMenuSheet {...base} onOpenTags={onOpenTags} />);
    fireEvent.click(screen.getByRole('button', { name: /Теги и метки/ }));
    expect(onOpenTags).toHaveBeenCalledTimes(1);
    unmount();
    wrap(<MobileArchiveMenuSheet {...base} onOpenTags={onOpenTags} tagsOpen />);
    expect(screen.getByRole('button', { name: /Скрыть теги/ })).toBeInTheDocument();
  });

  // MF-17: тот же переключатель у календаря.
  it('the calendar item toggles: «Календарь и статистика» → «Скрыть календарь»', () => {
    const base = {
      open: true, onClose: vi.fn(), viewMode: 'list' as const, onViewModeChange: vi.fn(), sortMode: 'newest' as never,
      onSortModeChange: vi.fn(), sortLabels: {} as never, onOpenTags: vi.fn(), activeTab: 'notes' as const,
      onTabChange: vi.fn(), trashCount: 0, onClearTrash: vi.fn(),
    };
    const onOpenCalendar = vi.fn();
    const { unmount } = wrap(<MobileArchiveMenuSheet {...base} onOpenCalendar={onOpenCalendar} />);
    fireEvent.click(screen.getByRole('button', { name: /Календарь и статистика/ }));
    expect(onOpenCalendar).toHaveBeenCalledTimes(1);
    unmount();
    wrap(<MobileArchiveMenuSheet {...base} onOpenCalendar={onOpenCalendar} calendarOpen />);
    expect(screen.getByRole('button', { name: /Скрыть календарь/ })).toBeInTheDocument();
  });

  it('on the phone the tag row is titled «Теги»', () => {
    wrap(<ArchiveTagBar allTags={['глина']} selectedTags={[]} onToggleTag={vi.fn()} renamingTag={null} renameTagValue=""
      setRenameTagValue={vi.fn()} onStartRename={vi.fn()} onRenameSubmit={vi.fn()} onRenameCancel={vi.fn()} onDeleteTag={vi.fn()}
      onResetTags={vi.fn()} showControls={false} labelKey="archive_tags_only" />);
    expect(screen.getByText('Теги')).toBeInTheDocument();
    expect(screen.queryByText('Теги/Метки')).toBeNull();
  });
});
