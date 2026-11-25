// EX-4 (PIN-1, диагностика): флаги отказа, не закреплённые ранее — ИИ-использование
// и статистика. Хук настоящий (useDiagnosticsData), моки только края: callAi (сервер),
// IndexedDB на чтении стора (отказ), тост, i18n, auth. Харнесс — из sus20.
// Мутация на флаг: убрать setAiUsageFailed(true) / setStatsFailed(true) — красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, screen, cleanup } from '@testing-library/react';
import 'fake-indexeddb/auto';

const mocks = vi.hoisted(() => ({
  getUsers: vi.fn(),
  callAi: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../../../core/data', () => ({ DataProvider: { getUsers: (...a: unknown[]) => mocks.getUsers(...a) } }));
vi.mock('../../../../core/ai/callAi', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../core/ai/callAi')>();
  return { ...actual, callAi: (...a: unknown[]) => mocks.callAi(...a) };
});
vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'admin-1', email: 'admin@example.com' }),
  reauthenticate: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string, p?: { count?: number | string }) => (p?.count === undefined ? k : `${k}:${p.count}`) }) }));
vi.mock('../../../auth/hooks/useAdminStatus', () => ({
  useAdminStatus: () => ({ isAdmin: true, isStaleToken: false, error: null }),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../services/AIProfileService', () => ({
  AIProfileService: { getPortrait: vi.fn().mockResolvedValue(null) },
  portraitCacheKey: () => 'portrait_cache_ex4',
}));

import { useDiagnosticsData } from '../useDiagnosticsData';
import { StorageService } from '../../../../core/services/StorageService';
import * as cloudListPartial from '../../../../core/services/cloudListPartial';
import { getLocalDb, resetDbInstance } from '../../../../core/storage/localDb';

function Harness({ tab }: { tab: 'ai_usage' | 'stats' }) {
  const data = useDiagnosticsData(null, false, tab);
  return <div>{`usage:${String(data.aiUsageFailed)} stats:${String(data.statsFailed)}`}</div>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  resetDbInstance();
  mocks.getUsers.mockResolvedValue([]);
  mocks.callAi.mockImplementation(async (endpoint: unknown) => {
    if (endpoint === 'listUsersWithStatus') return [];
    if (endpoint === 'getAIUsageStats') return { stats: [], totals: null, limits: null };
    return {};
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

// Дейлик 24.11 (Н-2): «Ошибок: 0» зелёным при непрочитанных версиях.
// Мутация: не складывать skippedVersions — красный.
describe('импорт из облака называет непрочитанные версии', () => {
  it.each([[1, true], [0, false]])('пропущено у каждой: %i → предупреждение %s', async (skippedVersions, warned) => {
    vi.spyOn(cloudListPartial, 'readCloudDocumentsPartial').mockResolvedValue({ docs: [{ id: 'c1' }, { id: 'c2' }], unreadable: [] } as never);
    vi.spyOn(StorageService, 'addLocalCopy').mockResolvedValue({ localId: 'doc_c', skippedVersions });
    const { result } = renderHook(() => useDiagnosticsData(null, false, 'stats'));
    await act(async () => { await result.current.handleImportAllFromCloud(); });
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('скачано 2 из 2'), warned ? 'warning' : 'success');
    expect(mocks.showToast.mock.calls.some(c => c[0] === `storage_download_versions_skipped:${skippedVersions * 2}`)).toBe(warned);
  });
});

describe('EX-4: отказ ИИ-использования и статистики назван, а не «пусто»', () => {
  it('сервер не отдал статистику ИИ — aiUsageFailed', async () => {
    mocks.callAi.mockImplementation(async (endpoint: unknown) => {
      if (endpoint === 'getAIUsageStats') throw new Error('SYNTHETIC_AI_USAGE_DOWN');
      if (endpoint === 'listUsersWithStatus') return [];
      return {};
    });
    render(<Harness tab="ai_usage" />);
    expect(await screen.findByText('usage:true stats:false')).toBeTruthy();
  });

  it('контроль: статистика ИИ пришла — отказа нет', async () => {
    render(<Harness tab="ai_usage" />);
    expect(await screen.findByText('usage:false stats:false')).toBeTruthy();
  });

  it('чтение локальных сторов упало — statsFailed', async () => {
    const db = await getLocalDb();
    const orig = db.getAll.bind(db) as (store: string) => Promise<unknown[]>;
    (db as unknown as { getAll: (store: string) => Promise<unknown[]> }).getAll = (store: string) =>
      store === 'aiSummaries' ? Promise.reject(new Error('SYNTHETIC_IDB_READ')) : orig(store);
    render(<Harness tab="stats" />);
    expect(await screen.findByText('usage:false stats:true')).toBeTruthy();
  });

  // Н-1 (дейлик 21.11): пропущенные заметки ≠ «все выгружены».
  // Мутация: убрать ветку skipped — зелёный тост, красный тест.
  it.each([
    [{ synced: 1, failed: 0, skipped: 2 }, 'settings_sync_all_skipped:2', 'warning'],
    [{ synced: 1, failed: 0, skipped: 0 }, 'Все локальные заметки выгружены в облако', 'success'],
  ])('выгрузка %o → %s', async (result, text, type) => {
    const { SyncService } = await import('../../../../core/services/SyncService');
    vi.spyOn(SyncService, 'syncAllUnlinked').mockResolvedValue(result);
    const { result: hook } = renderHook(() => useDiagnosticsData(null, false, 'stats'));
    await act(async () => { await hook.current.handleSyncAllToCloud(); });
    expect(mocks.showToast.mock.calls.map(c => [c[0], c[1]])).toEqual([[text, type]]);
  });
});
