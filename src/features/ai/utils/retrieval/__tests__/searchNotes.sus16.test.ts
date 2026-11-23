// NB-17 №16 (sus16): отказ embed в searchNotes возвращал [] без пометки —
// бенч реранка считал прогон чистым («Прогон завершён» зелёным), хотя
// семантический путь не выполнился. Отказ embed ставит rerankFailed в meta.
// Путь настоящий поверх fake-indexeddb; моки только края (провайдер ИИ,
// облачные векторы, auth). Мутация: убрать onRerankMeta из отказа embed —
// красные а, б.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../../../../core/storage/localDb';

vi.mock('../../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_sus16' }) }));
vi.mock('../../services/AIEmbeddingService', () => ({
  AIEmbeddingService: { getAll: vi.fn(async () => []) },
}));
vi.mock('../../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
const embed = vi.fn();
vi.mock('../../services/AIService', () => ({ AIService: { embed: (...a: unknown[]) => embed(...a) } }));

import { searchNotes } from '../searchNotes';
import { invalidateMiniSearchCache } from '../indexCache';

const CONSENT_KEY = 'ai_indexing_consent_v2_u_sus16';

beforeEach(async () => {
  vi.clearAllMocks();
  resetDbInstance();
  invalidateMiniSearchCache();
  localStorage.clear();
  localStorage.setItem(CONSENT_KEY, 'granted');
  await getLocalDb('u_sus16');
});

describe('NB-17 №16: отказ embed назван в meta прогона', () => {
  it('а) embed отказал — rerankFailed:true и пустая выдача', async () => {
    embed.mockResolvedValue({ ok: false, error: 'SYNTHETIC_EMBED' });
    const meta = vi.fn();
    const res = await searchNotes('синтетический запрос', 5, { skipRerank: false, onRerankMeta: meta });
    expect(res).toEqual([]);
    expect(meta).toHaveBeenCalledWith(expect.objectContaining({ rerankFailed: true }));
  });

  it('б) embed ответил без вектора — rerankFailed:true', async () => {
    embed.mockResolvedValue({ ok: true, vectors: [] });
    const meta = vi.fn();
    const res = await searchNotes('синтетический запрос', 5, { skipRerank: false, onRerankMeta: meta });
    expect(res).toEqual([]);
    expect(meta).toHaveBeenCalledWith(expect.objectContaining({ rerankFailed: true }));
  });

  it('контроль: согласие не дано — обход назван, не отказ реранка', async () => {
    localStorage.removeItem(CONSENT_KEY);
    const meta = vi.fn();
    await searchNotes('синтетический запрос', 5, { skipRerank: false, onRerankMeta: meta });
    expect(meta).toHaveBeenCalledWith(expect.objectContaining({ bypassed: true, bypassReason: 'indexing_consent_refused' }));
    expect(meta).not.toHaveBeenCalledWith(expect.objectContaining({ rerankFailed: true }));
    expect(embed).not.toHaveBeenCalled();
  });
});