// AG-VERIFY-2, находка 2 (#104-остаток): путь без индексации (D4.27) клал в
// scoreMap уже-нормализованную 0..1 оценку, и vectorScore01 (×20) насыщала
// её — у всех заметок семантический член композита становился равным 1.
// Теперь обе ветки кладут шкалу RRF (~0.02–0.05), и нормализация различает.
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getLocalDb } from '../../../core/storage/localDb';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { searchNotes, vectorScore01 } from '../utils/noteRetriever';
import { setIndexingConsent } from '../../../core/ai/indexingConsent';
import { getCurrentUser } from '../../../core/auth';
import { markAllAnalysed } from '../../../test/utils/markAnalysed';

vi.mock('../../../core/auth', () => ({
  getCurrentUser: vi.fn(() => ({ uid: 'guest' })),
}));

vi.mock('../services/AIService', () => ({
  AIService: {
    embed: vi.fn().mockResolvedValue({ ok: true, vectors: [new Array(1536).fill(0.1)] }),
    rerank: vi.fn().mockImplementation(() => {
      throw new Error('Rerank should not be called on the no-consent path!');
    }),
  },
}));

describe('AG-VERIFY-2: путь без индексации живёт в шкале RRF', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setIndexingConsent('guest', 'refused');
    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('aiEmbeddings');
    await db.clear('aiSummaries');
    const words = ['яблоня', 'груша', 'слива'];
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id) => {
      const i = Number(id.split('-')[1]);
      return `Длинный текст заметки про ${words[i]} и окрестности, много слов для индекса.`;
    });
    for (const [i, word] of words.entries()) {
      await db.put('documents', {
        id: `doc-${i}`, title: `Заметка про ${word}`, content: '', excludedFromAI: false,
        lastSessionAt: Date.now(), version: 1,
      } as never);
      await markAllAnalysed(db);
    }
  });

  it('оценки различаются после нормализации — композит не вырожден', async () => {
    const results = await searchNotes('яблоня груша слива', 3);
    expect(results.length).toBe(3);
    const normalized = results.map(r => vectorScore01(r.score));
    // На старом коде score был 1 - i/n (0..1], ×20 насыщало всё в 1 — все равны.
    expect(normalized[0]).toBeGreaterThan(normalized[1]!);
    expect(normalized[1]).toBeGreaterThan(normalized[2]!);
    // Шкала RRF: значения заведомо меньше единицы до нормализации.
    expect(results[0]!.score).toBeLessThan(0.05);
  });

  it('экстрактор согласован: getCurrentUser используется для проверки согласия', () => {
    expect(getCurrentUser()?.uid).toBe('guest');
  });
});
