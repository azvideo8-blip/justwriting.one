// NB-13 (sus10): облако сообщило, что N заметок не прочитались ключом и тег
// в них не обновлён — итог не зелёный, а warning «N заметок не обновлены».
// Харнесс — из useTagEditorCloudFail.test.ts; хук настоящий, моки только края.
// Мутация: убрать ветку skipped>0 (всегда success) — красные а, б.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const showToast = vi.fn();
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string, p?: Record<string, string | number>) =>
      p?.count !== undefined ? `${k}:${p.count}` : k,
  }),
}));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: async () => true }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: { renameTagInAllDocs: vi.fn(async () => {}), removeTagFromAllDocs: vi.fn(async () => {}) },
}));
vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: { renameTagInAllDocs: vi.fn(), removeTagFromAllDocs: vi.fn() },
}));

import { useTagEditor } from '../useTagEditor';
import { DocumentService } from '../../../../core/services/DocumentService';

describe('NB-13: пропущенные заметки названы в итоге тега', () => {
  beforeEach(() => vi.clearAllMocks());

  it('а) rename: облако пропустило 2 — warning с числом, не success', async () => {
    vi.mocked(DocumentService.renameTagInAllDocs).mockResolvedValue(2);
    const fetchSessions = vi.fn(async () => {});
    const { result } = renderHook(() => useTagEditor('u_tag', fetchSessions));
    await act(async () => { await result.current.handleRenameTag('старый', 'новый'); });
    expect(showToast).toHaveBeenCalledWith('tag_update_skipped:2', 'warning');
    expect(showToast).not.toHaveBeenCalledWith('tag_renamed', 'success');
    expect(fetchSessions).toHaveBeenCalledTimes(1);
  });

  it('б) delete: облако пропустило 1 — warning с числом, не success', async () => {
    vi.mocked(DocumentService.removeTagFromAllDocs).mockResolvedValue(1);
    const fetchSessions = vi.fn(async () => {});
    const { result } = renderHook(() => useTagEditor('u_tag', fetchSessions));
    await act(async () => { await result.current.requestDeleteTag('старый'); });
    expect(showToast).toHaveBeenCalledWith('tag_update_skipped:1', 'warning');
    expect(showToast).not.toHaveBeenCalledWith('tag_deleted', 'success');
  });

  it('контроль: пропущенных нет — зелёный итог как раньше', async () => {
    vi.mocked(DocumentService.renameTagInAllDocs).mockResolvedValue(0);
    const fetchSessions = vi.fn(async () => {});
    const { result } = renderHook(() => useTagEditor('u_tag', fetchSessions));
    await act(async () => { await result.current.handleRenameTag('старый', 'новый'); });
    expect(showToast).toHaveBeenCalledWith('tag_renamed', 'success');
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('tag_update_skipped'), 'warning');
  });
});