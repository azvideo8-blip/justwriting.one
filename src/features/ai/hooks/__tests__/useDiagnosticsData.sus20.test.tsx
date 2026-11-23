// NB-17 №20 (sus20): сбой чтения истории разборов — не «пустая история».
// Хук настоящий (useDiagnosticsData), моки только края: админ-данные, тост,
// i18n, auth, портрет, IndexedDB на чтении aiSummaries. Харнесс — из sus19.
// Мутация: убрать setSummaryLogsFailed(true) из catch — красный а.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../auth/hooks/useAdminStatus', () => ({
  useAdminStatus: () => ({ isAdmin: true, isStaleToken: false, error: null }),
}));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../services/AIProfileService', () => ({
  AIProfileService: { getPortrait: vi.fn().mockResolvedValue(null) },
  portraitCacheKey: () => 'portrait_cache_sus20',
}));

import { useDiagnosticsData } from '../useDiagnosticsData';
import { getLocalDb, resetDbInstance } from '../../../../core/storage/localDb';

function Harness() {
  const data = useDiagnosticsData(null, false, 'ai_profile');
  return <div>{`logs:${data.summaryLogs.length} failed:${String(data.summaryLogsFailed)}`}</div>;
}

type DbWithGetAll = { getAll: (store: string) => Promise<unknown[]> };

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  resetDbInstance();
  mocks.getUsers.mockResolvedValue([]);
  mocks.callAi.mockImplementation(async (endpoint: unknown) => {
    if (endpoint === 'listUsersWithStatus') return [];
    if (endpoint === 'listAdminActions') return [];
    return {};
  });
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries'] as const) {
    await db.clear(store);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('NB-17 №20: отказ чтения истории разборов назван', () => {
  it('а) чтение aiSummaries упало — summaryLogsFailed, а не тихий пустой список', async () => {
    const db = await getLocalDb();
    const orig = db.getAll.bind(db) as (store: string) => Promise<unknown[]>;
    (db as unknown as DbWithGetAll).getAll = (store: string) =>
      store === 'aiSummaries' ? Promise.reject(new Error('SYNTHETIC_IDB_READ')) : orig(store);

    render(<Harness />);
    expect(await screen.findByText('logs:0 failed:true')).toBeTruthy();
  });

  it('контроль: история прочиталась — строка есть, отказа нет', async () => {
    const db = await getLocalDb();
    const now = Date.now();
    await db.put('documents', {
      id: 'doc_sus20h', guestId: 'admin-1', title: 'doc_sus20h', currentVersion: 1,
      totalWords: 20, totalDuration: 100, sessionsCount: 1,
      firstSessionAt: now, lastSessionAt: now, tags: [],
    } as never);
    await db.put('aiSummaries', {
      documentId: 'doc_sus20h', tone: 'нейтрально', frequentWords: [], insights: [],
      themes: [], extractedFacts: [], processedAt: now, contentHash: 'h',
    } as never);

    render(<Harness />);
    expect(await screen.findByText('logs:1 failed:false')).toBeTruthy();
  });
});