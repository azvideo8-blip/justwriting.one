// HA-2 (дейлик 26.11, Н-1): «Analyze with AI» в Диагностике отправлял модели текст заметки,
// скрытой от ИИ или выброшенной в корзину, и только потом говорил «пропущено».
// Хук настоящий поверх fake-indexeddb; моки только края (облако, тост, i18n, auth, модель).
// Мутации: снять проверку перед чтением версий; не помечать строку в списке — красный.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const { getUserDocuments, showToast, summarize } = vi.hoisted(() => ({ getUserDocuments: vi.fn(), showToast: vi.fn(), summarize: vi.fn() }));

vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ user: null }) }));
vi.mock('../../../../core/services/SyncService', () => ({ SyncService: { syncPending: vi.fn() } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: { getUserDocuments, getCloudVersionDiscrepancyCount: vi.fn(async () => 0) },
}));
vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../services/AIService', () => ({ AIService: { summarize } }));
vi.mock('../../../../core/auth', async importOriginal => ({ ...(await importOriginal<object>()), getCurrentUser: () => ({ uid: 'u_diag_ha2' }) }));

import { useSyncDiagnostics } from '../useSyncDiagnostics';
import { getLocalDb, resetDbInstance } from '../../../../core/storage/localDb';

const USER = 'u_diag_ha2';
const TEXT = 'MARKER_HA2_DIAG_TEXT синтетическая запись достаточно длинная, чтобы её разрешили разбирать моделью.';

async function seed(id: string, over: object = {}) {
  const db = await getLocalDb();
  await db.put('documents', { id, guestId: USER, title: id, currentVersion: 1, totalWords: 12, ...over } as never);
  await db.put('versions', { id: `v_${id}`, documentId: id, version: 1, content: TEXT, guestId: USER, savedAt: 1, sessionStartedAt: 1, wordCount: 12, duration: 1, wpm: 1 } as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetDbInstance();
  localStorage.clear();
  const db = await getLocalDb();
  for (const s of ['documents', 'versions', 'syncQueue', 'aiSummaries'] as const) await db.clear(s);
  getUserDocuments.mockResolvedValue([]);
  summarize.mockResolvedValue({ ok: true, summary: { tone: 't', frequentWords: [], insights: [], themes: [], extractedFacts: [] } });
});

const run = async (id: string) => {
  const { result } = renderHook(() => useSyncDiagnostics({ userId: USER }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { await result.current.handleProcessDocument({ id, localId: id } as never); });
  return result;
};

describe('HA-2: разбор в Диагностике и скрытая заметка', () => {
  it.each([['скрыта от ИИ', { excludedFromAI: true }], ['в корзине', { trashedAt: 1 }]])('%s: модели ничего не ушло, сказано до отправки, строка помечена', async (_n, over) => {
    await seed('doc_h', over);
    const result = await run('doc_h');
    expect(await (await getLocalDb()).get('documents', 'doc_h')).toBeTruthy();
    expect(summarize).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('admin_sync_toast_ai_skipped', 'warning');
    expect(result.current.items.find(i => i.id === 'doc_h')?.hiddenFromAI).toBe(true);
  });

  it('строки нет — модели ничего не ушло', async () => {
    const db = await getLocalDb();
    await db.put('versions', { id: 'v_x', documentId: 'doc_x', version: 1, content: TEXT, guestId: USER } as never);
    await run('doc_x');
    expect(summarize).not.toHaveBeenCalled();
  });

  it('видимая заметка — разбор уходит (контроль)', async () => {
    await seed('doc_v');
    const result = await run('doc_v');
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(summarize.mock.calls[0])).toContain('MARKER_HA2_DIAG_TEXT');
    expect(showToast).not.toHaveBeenCalledWith('admin_sync_toast_ai_skipped', 'warning');
    expect(result.current.items.find(i => i.id === 'doc_v')?.hiddenFromAI).toBe(false);
  });
});
