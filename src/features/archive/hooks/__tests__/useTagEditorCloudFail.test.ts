// 0.11.22: переименование/удаление тега — устройство применило, облако отказало.
// Раньше список не перечитывался и показывал теги до попытки, хотя на устройстве
// они уже другие. Мутация: убрать `void fetchSessions()` из catch — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const showToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: async () => true }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { renameTagInAllDocs: vi.fn(async () => {}), removeTagFromAllDocs: vi.fn(async () => {}) },
}));
vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: {
    renameTagInAllDocs: vi.fn(async () => { throw new Error('unavailable'); }),
    removeTagFromAllDocs: vi.fn(async () => { throw new Error('unavailable'); }),
  },
}));

import { useTagEditor } from '../useTagEditor';

describe('useTagEditor: облако отказало', () => {
  beforeEach(() => vi.clearAllMocks());

  it('переименование — ошибка и список перечитан', async () => {
    const fetchSessions = vi.fn(async () => {});
    const { result } = renderHook(() => useTagEditor('u_tag', fetchSessions));
    await act(async () => { await result.current.handleRenameTag('старый', 'новый'); });
    expect(showToast).toHaveBeenCalledWith('error_tag_rename_failed', 'error');
    expect(fetchSessions).toHaveBeenCalledTimes(1);
  });

  it('удаление — ошибка и список перечитан', async () => {
    const fetchSessions = vi.fn(async () => {});
    const { result } = renderHook(() => useTagEditor('u_tag', fetchSessions));
    await act(async () => { await result.current.requestDeleteTag('старый'); });
    expect(showToast).toHaveBeenCalledWith('error_tag_delete_failed', 'error');
    expect(fetchSessions).toHaveBeenCalledTimes(1);
  });
});
