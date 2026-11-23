// NB-17 №20 (sus20): сбой чтения статистики массового разбора — не «0 заметок»
// и не «Завершено 🎉». Компонент настоящий (MassAnalyzeNotes), моки только края:
// тост, auth, IndexedDB на чтении documents. Мутация: убрать setStatsError(true)
// из catch loadStats — красный а.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, cleanup } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { renderWithProviders } from '../../../test/utils/render';
import { MassAnalyzeNotes } from '../DiagnosticsPage';
import { getLocalDb, resetDbInstance } from '../../../core/storage/localDb';

vi.mock('../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../core/auth', () => ({ getCurrentUser: vi.fn(() => null) }));

type DbWithGetAll = { getAll: (store: string) => Promise<unknown[]> };

let override: ((store: string) => Promise<unknown[]>) | null = null;

beforeEach(async () => {
  localStorage.clear();
  resetDbInstance();
  override = null;
  const db = await getLocalDb();
  for (const store of ['documents', 'versions', 'aiSummaries'] as const) {
    await db.clear(store);
  }
  const orig = db.getAll.bind(db) as (store: string) => Promise<unknown[]>;
  (db as unknown as DbWithGetAll).getAll = (store: string) =>
    override ? override(store) : orig(store);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NB-17 №20: отказ чтения статистики назван, а не «Завершено 🎉»', () => {
  it('а) чтение documents упало — строка ошибки с повтором, не «Завершено 🎉»', async () => {
    const db = await getLocalDb();
    const orig = (db as unknown as DbWithGetAll).getAll;
    override = (store: string) =>
      store === 'documents' ? Promise.reject(new Error('SYNTHETIC_IDB_READ')) : orig(store);

    renderWithProviders(<MassAnalyzeNotes />);
    expect(await screen.findByText('Не прочиталось — попробуй ещё раз')).toBeTruthy();
    expect(screen.queryByText(/Завершено/)).toBeNull();
    expect(screen.queryByText(/0 \/ 0 заметок/)).toBeNull();
  });

  it('контроль: всё прочиталось и разобрано — «Завершено 🎉» как раньше', async () => {
    const db = await getLocalDb();
    const now = Date.now();
    await db.put('documents', {
      id: 'doc_sus20', guestId: 'guest', title: 'doc_sus20', currentVersion: 1,
      totalWords: 20, totalDuration: 100, sessionsCount: 1,
      firstSessionAt: now, lastSessionAt: now, tags: [],
    } as never);
    await db.put('aiSummaries', {
      documentId: 'doc_sus20', tone: 'нейтрально', frequentWords: [], insights: [],
      themes: [], extractedFacts: [], processedAt: now, contentHash: 'h',
    } as never);

    renderWithProviders(<MassAnalyzeNotes />);
    await waitFor(() => expect(screen.getByText(/Завершено/)).toBeTruthy());
    expect(screen.queryByText('Не прочиталось — попробуй ещё раз')).toBeNull();
  });
});