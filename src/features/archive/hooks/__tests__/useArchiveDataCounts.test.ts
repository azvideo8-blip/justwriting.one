import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useArchiveData } from '../useArchiveData';
import { useArchiveSessions } from '../useArchiveSessions';
import type { ArchiveSession } from '../../types';

vi.mock('../useArchiveSessions', () => ({
  useArchiveSessions: vi.fn(),
}));

vi.mock('../useArchiveWordCloud', () => ({
  useArchiveWordCloud: () => ({ wordCloud: [], maxCount: 0 }),
}));

describe('useArchiveData counts', () => {
  it('correctly calculates tagCounts and labelCounts for sessions (3 sessions, 2 tags, 1 label, and handles session without tags)', () => {
    const mockSessions: Partial<ArchiveSession>[] = [
      { id: '1', tags: ['writing', 'ideas'], labelId: 'lbl-work' },
      { id: '2', tags: ['writing'], labelId: 'lbl-work' },
      { id: '3', tags: undefined, labelId: undefined },
    ];

    vi.mocked(useArchiveSessions).mockReturnValue({
      sessions: mockSessions as ArchiveSession[],
      activeSessions: mockSessions as ArchiveSession[],
      trashedSessions: [],
      loading: false,
      error: null,
      cloudLoadFailed: false,
      previewSession: null,
      setPreviewSession: vi.fn(),
      deleteConfirm: null,
      setDeleteConfirm: vi.fn(),
      permanentDeleteConfirm: null,
      setPermanentDeleteConfirm: vi.fn(),
      emptyTrashConfirm: false,
      setEmptyTrashConfirm: vi.fn(),
      fetchSessions: vi.fn(),
      handleDeleteSession: vi.fn(),
      handleTrashSession: vi.fn(),
      handleRestoreSession: vi.fn(),
      handlePermanentDeleteSession: vi.fn(),
      handleEmptyTrash: vi.fn(),
      handleTagsChange: vi.fn(),
      handleTitleChange: vi.fn(),
      handleDateChange: vi.fn(),
      handleLabelChange: vi.fn(),
      openPreview: vi.fn(),
    });

    const t = (k: string) => k;
    const { result } = renderHook(() =>
      useArchiveData(null, 'user-1', t, 'ru', [{ id: 'lbl-work', name: 'Work', color: '#ff0000' }])
    );

    expect(result.current.tagCounts).toEqual({
      writing: 2,
      ideas: 1,
    });
    expect(result.current.labelCounts).toEqual({
      'lbl-work': 2,
    });
    expect(result.current.allTags).toEqual(['writing', 'ideas']);
  });
});
