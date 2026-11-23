// NB-17 №8 (sus08): «Разобрать ИИ» на исключённой заметке — save молча
// пропускал, хук ставил aiProcessed:true и показывал зелёное «завершено».
// Хук настоящий поверх fake-indexeddb; моки только края (тост, i18n, auth,
// облако, провайдер ИИ). Мутация: убрать ветку skipped — красный а.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { showToast, summarize } = vi.hoisted(() => ({ showToast: vi.fn(), summarize: vi.fn() }));

vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ user: null }) }));
vi.mock('../../../../core/services/SyncService', () => ({ SyncService: { syncPending: vi.fn() } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: {
    getUserDocuments: vi.fn(async () => []),
    getCloudVersionDiscrepancyCount: vi.fn(async () => 0),
  },
}));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../services/AIService', () => ({ AIService: { summarize } }));

import { useSyncDiagnostics, type DiagnosticItem } from '../useSyncDiagnostics';
import { getLocalDb, resetDbInstance } from '../../../../core/storage/localDb';

const LONG_TEXT = 'Синтетический текст заметки, достаточно длинный для разбора ИИ — больше пятидесяти символов.';

const item = (localId: string): DiagnosticItem => ({
  id: localId, title: 'Синтетика', localId, hasLocal: true, hasCloud: false,
  inQueue: false, status: 'local_only',
});

async function seed(docId: string, excluded: boolean) {
  const db = await getLocalDb();
  await db.put('documents', { id: docId, guestId: 'guest', title: 'Синтетика', ...(excluded ? { excludedFromAI: true } : {}) } as never);
  await db.put('versions', { id: `v_${docId}`, documentId: docId, guestId: 'guest', version: 1, content: LONG_TEXT, savedAt: 1000 } as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetDbInstance();
  localStorage.clear();
  summarize.mockResolvedValue({
    ok: true,
    summary: { tone: 'neutral', frequentWords: [], insights: [], themes: [], extractedFacts: [] },
  });
});
afterEach(() => vi.restoreAllMocks());

describe('NB-17 №8: исключённая заметка не получает зелёный итог разбора', () => {
  it('а) заметка исключена — warning, aiProcessed не поставлен', async () => {
    await seed('doc_ex', true);
    const { result, unmount } = renderHook(() => useSyncDiagnostics({ userId: 'u_diag' }));
    showToast.mockClear();
    await act(async () => { await result.current.handleProcessDocument(item('doc_ex')); });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('admin_sync_toast_ai_skipped', 'warning'));
    expect(showToast).not.toHaveBeenCalledWith('admin_sync_toast_ai_done', 'success');
    const db = await getLocalDb();
    const doc = await db.get('documents', 'doc_ex') as { aiProcessed?: boolean };
    expect(doc.aiProcessed).toBeFalsy();
    expect(await db.get('aiSummaries', 'doc_ex')).toBeUndefined();
    unmount();
  });

  it('контроль: обычная заметка — зелёный итог и aiProcessed', async () => {
    await seed('doc_ok', false);
    const { result, unmount } = renderHook(() => useSyncDiagnostics({ userId: 'u_diag' }));
    showToast.mockClear();
    await act(async () => { await result.current.handleProcessDocument(item('doc_ok')); });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('admin_sync_toast_ai_done', 'success'));
    const db = await getLocalDb();
    const doc = await db.get('documents', 'doc_ok') as { aiProcessed?: boolean };
    expect(doc.aiProcessed).toBe(true);
    unmount();
  });
});