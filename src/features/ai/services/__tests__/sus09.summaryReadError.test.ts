// NB-3 (sus09): AISummaryService.get отличает «разбора нет» от «облако не
// ответило»: отказ чтения бросается, а не возвращается undefined.
// Мутация: catch → return undefined (без броска) → случай отказа красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const getSummary = vi.hoisted(() => vi.fn());
vi.mock('../../../../core/data', () => ({ DataProvider: { getSummary } }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_sus09' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { AISummaryService } from '../AISummaryService';
import { getLocalDb } from '../../../../core/storage/localDb';

describe('NB-3 sus09: summary read refusal is not «no summary»', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await getLocalDb();
    await db.clear('aiSummaries');
  });

  it('облако отказало → бросок, сводка не записана', async () => {
    getSummary.mockRejectedValue(new Error('cloud down'));
    await expect(AISummaryService.get('doc_sus09')).rejects.toThrow('cloud down');
    const db = await getLocalDb();
    expect(await db.get('aiSummaries', 'doc_sus09')).toBeUndefined();
  });

  it('контроль: облако ответило «нет» → undefined, без броска', async () => {
    getSummary.mockResolvedValue(null);
    await expect(AISummaryService.get('doc_sus09')).resolves.toBeUndefined();
  });

  it('контроль: локальная сводка есть → она и отдаётся, облако не трогается', async () => {
    const db = await getLocalDb();
    const local = { documentId: 'doc_sus09', summary: 'синтетика', tone: '', frequentWords: [], insights: [], themes: [], extractedFacts: [], processedAt: 1 };
    await db.put('aiSummaries', local);
    await expect(AISummaryService.get('doc_sus09')).resolves.toEqual(local);
    expect(getSummary).not.toHaveBeenCalled();
  });
});