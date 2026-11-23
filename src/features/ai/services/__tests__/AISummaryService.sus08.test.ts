// NB-17 №8 (sus08): AISummaryService.save молча выходил, когда заметка
// исключена из ИИ (или её нет) — вызывающий считал разбор сохранённым.
// save возвращает 'saved' | 'skipped'. Путь настоящий: fake-indexeddb,
// мок только края (облако выключено, auth).
// Мутация: ранний выход возвращает 'saved' — красные а, б.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../core/sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => null }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { AISummaryService } from '../AISummaryService';
import { getLocalDb, resetDbInstance } from '../../../../core/storage/localDb';

const summary = (documentId: string) => ({
  documentId, tone: 'neutral', frequentWords: [], insights: [], themes: [],
  extractedFacts: [], processedAt: 1, contentHash: 'h',
});

beforeEach(async () => {
  resetDbInstance();
  localStorage.clear();
  const db = await getLocalDb();
  await db.clear('documents');
  await db.clear('aiSummaries');
});

describe('NB-17 №8: save называет пропуск', () => {
  it('а) заметка исключена из ИИ — skipped, сводка не записана', async () => {
    const db = await getLocalDb();
    await db.put('documents', { id: 'doc_ex', guestId: 'guest', title: 'Синтетика', excludedFromAI: true } as never);
    await expect(AISummaryService.save(summary('doc_ex') as never)).resolves.toBe('skipped');
    expect(await db.get('aiSummaries', 'doc_ex')).toBeUndefined();
  });

  it('б) заметки нет на устройстве — skipped', async () => {
    await expect(AISummaryService.save(summary('doc_missing') as never)).resolves.toBe('skipped');
  });

  it('контроль: обычная заметка — saved, сводка записана', async () => {
    const db = await getLocalDb();
    await db.put('documents', { id: 'doc_ok', guestId: 'guest', title: 'Синтетика' } as never);
    await expect(AISummaryService.save(summary('doc_ok') as never)).resolves.toBe('saved');
    expect(await db.get('aiSummaries', 'doc_ok')).toBeTruthy();
  });
});