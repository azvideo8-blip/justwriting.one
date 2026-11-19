// d39b: вкладка «Корзина» при сбое чтения архива показывает «Корзина пуста».
// Настоящие ArchivePage + ArchiveHeader + ArchiveTrashView + ArchiveNoteList;
// мок только края данных (useArchiveData — обёртка над IndexedDB/облаком)
// и тяжёлых презентационных панелей, не участвующих в проверке.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h } from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const archiveData = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('@/features/archive/hooks/useArchiveData', () => ({
  useArchiveData: () => archiveData.current,
}));
vi.mock('@/features/profile/hooks/useProfileLabels', () => ({
  useProfileLabels: () => ({ labels: [], addLabel: vi.fn(), updateLabel: vi.fn(), removeLabel: vi.fn() }),
}));
vi.mock('@/features/archive/hooks/useTagEditor', () => ({
  useTagEditor: () => ({
    renamingTag: null, renameTagValue: '', setRenameTagValue: vi.fn(),
    startRenameTag: vi.fn(), handleRenameTag: vi.fn(), setRenamingTag: vi.fn(), requestDeleteTag: vi.fn(),
  }),
}));
vi.mock('@/features/archive/hooks/useLabelEditor', () => ({
  useLabelEditor: () => ({
    addingLabel: false, setAddingLabel: vi.fn(), newLabelName: '', setNewLabelName: vi.fn(),
    newLabelColor: '#000', setNewLabelColor: vi.fn(), handleAddLabel: vi.fn(),
    editingLabelId: null, setEditingLabelId: vi.fn(), editLabelName: '', setEditLabelName: vi.fn(),
    editLabelColor: '#000', setEditLabelColor: vi.fn(), handleUpdateLabel: vi.fn(), requestDeleteLabel: vi.fn(),
  }),
}));
vi.mock('@/features/archive/hooks/useArchiveGrouping', () => ({
  useArchiveGrouping: () => ({ groupedSessions: [], sortedDates: [] }),
}));
vi.mock('@/features/archive/hooks/useArchiveWordCloud', () => ({ rebuildWordCloud: vi.fn(async () => {}) }));
vi.mock('@/shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'desktop', setLayoutMode: vi.fn() }) }));
vi.mock('@/shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }) }));
vi.mock('@/features/archive/components/ArchiveTagBar', () => ({ ArchiveTagBar: () => null }));
vi.mock('@/features/archive/components/ArchiveLabelBar', () => ({ ArchiveLabelBar: () => null }));
vi.mock('@/core/components/OnThisDayCard', () => ({ OnThisDayCard: () => null }));
vi.mock('@/features/archive/components/ImportDropOverlay', () => ({ ImportDropOverlay: () => null }));
vi.mock('@/features/archive/components/MobileArchiveSidebarSheet', () => ({
  ArchiveSidebarContent: () => null, MobileArchiveSidebarSheet: () => null,
}));
vi.mock('@/features/archive/components/MobileInlinePanel', () => ({ MobileInlinePanel: () => null }));
vi.mock('@/features/archive/components/MobileArchiveMenuSheet', () => ({ MobileArchiveMenuSheet: () => null }));
vi.mock('@/features/archive/components/MobileArchiveHeader', () => ({ MobileArchiveHeader: () => null }));
vi.mock('@/features/ai/services/NoteAnalysisService', () => ({ NoteAnalysisService: { analyze: vi.fn(), clear: vi.fn() } }));
vi.mock('@/features/ai/services/AISummaryService', () => ({ AISummaryService: { hasAll: vi.fn(async () => ({})) } }));
vi.mock('@/features/ai/utils/relatedNotes', () => ({ findRelatedNotes: vi.fn(async () => []) }));
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { ArchivePage } from '@/app/pages/ArchivePage';
import { ToastProvider } from '@/shared/components/Toast';
import { LanguageProvider } from '@/shared/i18n';

function baseData(overrides: Record<string, unknown> = {}) {
  return {
    loading: false, error: null, cloudLoadFailed: false,
    fetchSessions: vi.fn(), sessions: [], trashedSessions: [],
    handleTrashSession: vi.fn(), handleRestoreSession: vi.fn(),
    handlePermanentDeleteSession: vi.fn(), handleEmptyTrash: vi.fn(),
    handleTagsChange: vi.fn(), handleTitleChange: vi.fn(), handleDateChange: vi.fn(), handleLabelChange: vi.fn(),
    previewSession: null, setPreviewSession: vi.fn(), openPreview: vi.fn(),
    allTags: [], tagCounts: {}, labelCounts: {}, filteredByFilters: [], filteredSessions: [],
    searchQuery: '', setSearchQuery: vi.fn(),
    selectedDate: null, setSelectedDate: vi.fn(), selectedMonth: null, setSelectedMonth: vi.fn(),
    selectedTags: [], setSelectedTags: vi.fn(), selectedLabels: [], setSelectedLabels: vi.fn(), toggleLabel: vi.fn(),
    statsTitle: '', hasActiveFilter: false, resetStatsFilter: vi.fn(),
    sessionsByDate: {}, wordsByDate: {}, wordCloud: [], maxCount: 0,
    groupedSessions: [], sortedDates: [], dateLocale: undefined,
    ...overrides,
  };
}

function renderPage() {
  return render(
    h(LanguageProvider, null,
      h(ToastProvider, null,
        h(MemoryRouter, null, h(ArchivePage, {
          user: { uid: 'u-d39b', email: 'd39b@example.test' } as never,
          profile: null,
        })))),
  );
}

async function openTrashTab() {
  fireEvent.click(screen.getByText('Корзина'));
  await waitFor(() => {
    expect(screen.queryByText('Здесь будут появляться удалённые заметки')).toBeTruthy();
  });
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('d39b: сбой чтения архива не выглядит как «Корзина пуста»', () => {
  it('error задан, вкладка Корзина — ошибка названа, а не «пуста»', async () => {
    archiveData.current = baseData({ error: 'Ошибка при загрузке заметок' });
    renderPage();
    fireEvent.click(screen.getByText('Корзина'));
    await waitFor(() => {
      expect(
        screen.queryByText('Корзина пуста') ?? screen.queryByText('Ошибка при загрузке заметок'),
        'вкладка корзины должна показать либо пустое состояние, либо ошибку',
      ).toBeTruthy();
    });
    expect(screen.queryByText('Корзина пуста'), 'сбой чтения показан как «Корзина пуста»').toBeNull();
    expect(screen.getByText('Ошибка при загрузке заметок')).toBeTruthy();
  });

  it('КОНТРОЛЬ: вкладка Заметки при том же error показывает ошибку', async () => {
    archiveData.current = baseData({ error: 'Ошибка при загрузке заметок' });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Ошибка при загрузке заметок')).toBeTruthy();
    });
  });

  it('КОНТРОЛЬ: без ошибки пустая корзина законно показывает «Корзина пуста»', async () => {
    archiveData.current = baseData();
    renderPage();
    await openTrashTab();
    expect(screen.getByText('Корзина пуста')).toBeTruthy();
  });
});
