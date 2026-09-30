import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../../shared/i18n';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { ActivityLogBadge } from '../../../app/ActivityLogBadge';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';
import { ProfilePage } from '../../../app/pages/ProfilePage';
import { BeliefsDiagnostics } from '../components/BeliefsDiagnostics';
import { EmbeddingDiagnostics } from '../components/EmbeddingDiagnostics';
import { FacetDiagnostics } from '../components/FacetDiagnostics';
import { MemoryAssemblerDiagnostics } from '../components/MemoryAssemblerDiagnostics';
import { QueueExplorer } from '../components/QueueExplorer';
import { SyncDiagnostics } from '../components/SyncDiagnostics';

vi.mock('../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({
    isAuthenticated: true,
    isGuest: false,
    user: { uid: 'u123', email: 'test@example.com' },
    profile: null,
    loading: false,
  }),
}));

vi.mock('../../../features/auth/hooks/useAdminStatus', () => ({
  useAdminStatus: () => ({
    isAdmin: true,
    loading: false,
  }),
}));

vi.mock('../../../features/profile/hooks/useProfileStats', () => ({
  useProfileStats: () => ({
    sessions: [
      {
        id: 's1',
        title: 'Session 1',
        date: Date.now(),
        words: 100,
        wordsAdded: 100,
        wordsDeleted: 0,
        durationSeconds: 120,
        wpm: 50,
        mode: 'zen',
      },
    ],
    kpiStats: {
      totalWords: 1000,
      totalSessions: 10,
      totalDurationSeconds: 1200,
      averageWpm: 50,
      longestStreakDays: 3,
      currentStreakDays: 1,
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('../services/AIConsolidationService', () => ({
  AIConsolidationService: {
    getAllBeliefs: vi.fn().mockResolvedValue([
      {
        id: 'b1',
        belief: 'Writing brings clarity to thoughts',
        judgeVerdict: 'PASSED',
        judgeReason: 'Consistent reflection',
        firstSeenAt: '2026-09-01',
        evidence: [{ id: 'e1', date: '2026-09-01', snippet: 'Clarity emerges when writing' }],
      },
    ]),
    getAllRejections: vi.fn().mockResolvedValue([
      {
        id: 'r1',
        rejectedTextSnippet: 'Distorted thought snippet',
        reason: 'Contradicts earlier facts',
        timestamp: Date.now(),
        clusterSize: 3,
        firstSeenAt: '2026-08-01',
        unitIds: ['u1'],
        kind: 'judge_rejected',
        rewriteAttempted: true,
      },
    ]),
    clearRejections: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../utils/embeddingIndexer', () => ({
  getIndexCoverage: vi.fn().mockResolvedValue({
    totalDocs: 10,
    indexed: 8,
    stale: 2,
    unsynced: 1,
    model: 'text-embedding-3-small',
    dim: 1536,
    lastProcessedAt: Date.now(),
  }),
  indexPending: vi.fn().mockResolvedValue({ ok: 2, skipped: 0, failed: 0 }),
  reindexAll: vi.fn().mockResolvedValue({ ok: 10, skipped: 0, failed: 0 }),
}));

vi.mock('../services/AIEmbeddingService', () => ({
  AIEmbeddingService: {
    getAll: vi.fn().mockResolvedValue([]),
    syncPendingToCloud: vi.fn().mockResolvedValue({ synced: 1, locked: false }),
  },
}));

vi.mock('../services/injectionJournal', () => ({
  InjectionJournal: {
    getStats: () => ({
      totalTurns: 105,
      medianOverlap: 0.85,
      mandatoryDropsCount: 0,
      p90BudgetUsage: 1200,
      maxBudget: 2000,
      wouldHaveDroppedByCategory: { 'fact': 2 },
    }),
    getEntries: () => [
      {
        id: 'j1',
        timestamp: Date.now(),
        candidates: ['c1', 'c2'],
        shadowComparison: {
          overlapRatio: 0.9,
          wouldHaveDropped: ['c1'],
        },
      },
    ],
    loadEntriesFromDb: vi.fn().mockResolvedValue(undefined),
    clearJournal: vi.fn(),
  },
}));

vi.mock('../services/memoryFlags', () => ({
  MemoryFlagsService: {
    getFlags: () => ({
      ff_memory_assembler_shadow: true,
      ff_memory_assembler_chat_memory: true,
      ff_memory_assembler_retrieval: true,
      ff_memory_assembler_turn1: true,
      ff_memory_assembler_portrait: true,
      ff_memory_assembler_beliefs: true,
    }),
    setFlag: vi.fn(),
    resetFlags: vi.fn(),
  },
}));

vi.mock('../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockResolvedValue([]),
    getAllFromIndex: vi.fn().mockResolvedValue([]),
    transaction: vi.fn().mockReturnValue({
      store: { delete: vi.fn(), get: vi.fn(), put: vi.fn() },
      done: Promise.resolve(),
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../hooks/useSyncDiagnostics', () => ({
  useSyncDiagnostics: () => ({
    loading: false,
    syncingId: null,
    items: [
      {
        id: 'doc-1',
        title: 'My First Note',
        localId: 'doc-1',
        cloudId: 'cloud-1',
        hasLocal: true,
        hasCloud: true,
        localVersion: 2,
        cloudVersion: 2,
        localWords: 150,
        cloudWords: 150,
        inQueue: false,
        status: 'synced',
        date: Date.now(),
      },
    ],
    queueCount: 0,
    discrepancyCount: 0,
    processedDocs: {},
    processingDocId: null,
    readSummary: null,
    setReadSummary: vi.fn(),
    hasEncryption: false,
    fetchData: vi.fn(),
    handleSyncItem: vi.fn(),
    handleDownloadItem: vi.fn(),
    handleUnlinkItem: vi.fn(),
    cloudReadFailed: false,
    handleEncryptItem: vi.fn(),
    handleClearQueueItem: vi.fn(),
    handleSyncAllQueue: vi.fn(),
    handleProcessDocument: vi.fn(),
    handleReadSummary: vi.fn(),
    getStatusBadge: (status: string) => <span>{status}</span>,
  }),
}));

const cyrillicRegex = /[\u0400-\u04FF]/;

function renderInLanguage(ui: React.ReactElement, lang: 'en' | 'ru') {
  localStorage.setItem(STORAGE_KEYS.APP_LANGUAGE, lang);
  return render(
    <MemoryRouter>
      <LanguageProvider>
        {ui}
      </LanguageProvider>
    </MemoryRouter>
  );
}

function checkNoCyrillicInNode(container: HTMLElement) {
  const text = container.textContent || '';
  expect(cyrillicRegex.test(text), `Expected no Cyrillic text in English but found: "${text.match(cyrillicRegex)?.[0]}" in "${text.slice(0, 100)}..."`).toBe(false);

  const elements = container.querySelectorAll('*');
  for (const el of Array.from(elements)) {
    for (const attrName of ['title', 'placeholder', 'aria-label']) {
      const val = el.getAttribute(attrName);
      if (val) {
        expect(cyrillicRegex.test(val), `Expected no Cyrillic in ${attrName} but found: "${val}"`).toBe(false);
      }
    }
  }
}

describe('T-1 (d) Diagnostics components English localization (no Cyrillic characters)', () => {
  beforeEach(() => {
    localStorage.clear();
    useActivityLogStore.setState({
      panelOpen: true,
      entries: [
        {
          id: 'log-1',
          time: Date.now(),
          level: 'info',
          source: 'sync',
          message: 'activity_cloud_note_saved',
          count: 1,
        },
      ],
    });
  });

  it('ActivityLogBadge has no Cyrillic in English', () => {
    const { container } = renderInLanguage(<ActivityLogBadge />, 'en');
    checkNoCyrillicInNode(container);
  });

  it('ProfilePage has no Cyrillic in English', () => {
    const { container } = renderInLanguage(<ProfilePage user={{ uid: 'u123', email: 'test@example.com' } as any} profile={null} />, 'en');
    checkNoCyrillicInNode(container);
  });

  it('BeliefsDiagnostics has no Cyrillic in English', async () => {
    const { container } = renderInLanguage(<BeliefsDiagnostics />, 'en');
    checkNoCyrillicInNode(container);
  });

  it('EmbeddingDiagnostics has no Cyrillic in English', async () => {
    const { container } = renderInLanguage(<EmbeddingDiagnostics />, 'en');
    checkNoCyrillicInNode(container);
  });

  it('FacetDiagnostics has no Cyrillic in English', () => {
    const { container } = renderInLanguage(<FacetDiagnostics />, 'en');
    checkNoCyrillicInNode(container);
  });

  it('MemoryAssemblerDiagnostics has no Cyrillic in English', () => {
    const { container } = renderInLanguage(<MemoryAssemblerDiagnostics />, 'en');
    checkNoCyrillicInNode(container);
  });

  it('QueueExplorer has no Cyrillic in English', () => {
    const { container } = renderInLanguage(<QueueExplorer userId="u123" />, 'en');
    checkNoCyrillicInNode(container);
  });

  it('SyncDiagnostics has no Cyrillic in English', () => {
    const { container } = renderInLanguage(<SyncDiagnostics userId="u123" />, 'en');
    checkNoCyrillicInNode(container);
  });

  // R5-028: «даты следуют языку интерфейса» держалось только на машине с
  // английской локалью — без языка в toLocaleDateString тест выше зелёный и на
  // сломанном коде. Здесь проверяется сама локаль, а не текст.
  it.each([['en', 'en-GB'], ['ru', 'ru-RU']] as const)('SyncDiagnostics форматирует дату в локали языка %s', (lang, locale) => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString');
    try {
      renderInLanguage(<SyncDiagnostics userId="u123" />, lang);
      expect(spy).toHaveBeenCalled();
      for (const call of spy.mock.calls) expect(call[0]).toBe(locale);
    } finally {
      spy.mockRestore();
    }
  });

  it('renders expected Russian Cyrillic strings when in Russian locale', () => {
    const { container } = renderInLanguage(<ActivityLogBadge />, 'ru');
    expect(cyrillicRegex.test(container.textContent || '')).toBe(true);
  });
});
