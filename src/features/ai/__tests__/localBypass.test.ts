import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getLocalDb } from '../../../core/storage/localDb';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { searchNotesMulti } from '../utils/noteRetriever';
import { setIndexingConsent } from '../../../core/ai/indexingConsent';

vi.mock('../services/AIService', () => ({
  AIService: {
    embed: vi.fn().mockResolvedValue({
      ok: true,
      vectors: [new Array(1536).fill(0.1)],
    }),
    rerank: vi.fn().mockImplementation(() => {
      throw new Error('Rerank should not be called when bypassing!');
    }),
  },
}));

describe('local bypass pre-pass (T-3)', () => {
  beforeEach(async () => {
    setIndexingConsent('guest', 'granted');
    const db = await getLocalDb();
    await db.clear('documents');
    await db.clear('aiEmbeddings');
    await db.clear('aiSummaries');
  });

  it('bypasses reranking when query contains exact quotes matching note content', async () => {
    const db = await getLocalDb();
    
    // Put a doc with version content
    await db.put('documents', {
      id: 'doc_quote_match',
      title: 'Усталость',
      lastSessionAt: Date.now(),
      version: 1,
    } as any);

    // Mock version store
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id) => {
      if (id === 'doc_quote_match') {
        return 'Иногда я чувствую сильное выгорание на работе.';
      }
      return '';
    });

    // Put a dummy embedding to satisfy retrieval flow
    await db.put('aiEmbeddings', {
      documentId: 'doc_quote_match',
      vectors: [new Array(1536).fill(0.1)],
      chunkTexts: ['Иногда я чувствую сильное выгорание на работе.'],
      model: 'test',
      dim: 1536,
      contentHash: 'test-hash',
      processedAt: Date.now(),
    });

    // Perform search with exact quote in quotes
    const result = await searchNotesMulti(['хочу обсудить «выгорание на работе»'], 5);
    const results = result.notes;
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.documentId).toBe('doc_quote_match');
  });

  it('bypasses reranking when query contains named entities matching note content', async () => {
    const db = await getLocalDb();
    
    // Put a doc with version content
    await db.put('documents', {
      id: 'doc_entity_match',
      title: 'Москва',
      lastSessionAt: Date.now(),
      version: 1,
    } as any);
    // Второй кандидат с тем же именем: гейт обхода по локальному совпадению в
    // `searchNotes` (literalBypass) требует ДВА попадания либо одно + дословную
    // цитату в запросе. Одно попадание сознательно считается дешёвым.
    await db.put('documents', {
      id: 'doc_entity_match_2',
      title: 'Командировка',
      lastSessionAt: Date.now(),
      version: 1,
    } as any);

    // Mock version store
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id) => {
      if (id === 'doc_entity_match') {
        return 'Мы приехали в город Санкт-Петербург.';
      }
      if (id === 'doc_entity_match_2') {
        return 'В Петербурге совещание перенесли на четверг.';
      }
      return '';
    });

    // Put a dummy embedding to satisfy retrieval flow
    await db.put('aiEmbeddings', {
      documentId: 'doc_entity_match',
      vectors: [new Array(1536).fill(0.1)],
      chunkTexts: ['Мы приехали в город Санкт-Петербург.'],
      model: 'test',
      dim: 1536,
      contentHash: 'test-hash',
      processedAt: Date.now(),
    });
    await db.put('aiEmbeddings', {
      documentId: 'doc_entity_match_2',
      vectors: [new Array(1536).fill(0.1)],
      chunkTexts: ['В Петербурге совещание перенесли на четверг.'],
      model: 'test',
      dim: 1536,
      contentHash: 'test-hash-2',
      processedAt: Date.now(),
    });

    // ВАЖНО (П-2): прежний запрос был «Расскажи про Санкт-Петербург» с ОДНОЙ
    // заметкой, и обход держался не на именованном совпадении, а на мёртвом
    // пороге `topScore >= 0.88`: запрос и заметка векторизованы одним mock-вектором,
    // косинус = 1,0. Токен с дефисом `extractNamedEntities` именем не считает
    // (в регулярке нет `-`), поэтому до П-2 тест проверял не то, что заявлял.
    // Теперь сюжет честный: имя без дефиса и два кандидата с ним. Дефисные
    // топонимы («Санкт-Петербург» целиком) парсер по-прежнему не видит — это
    // открытая находка, а не регрессия П-2.
    const result = await searchNotesMulti(['Расскажи про Петербург'], 5);
    const results = result.notes;

    expect(results.length).toBeGreaterThan(1);
    expect(results.map(r => r.documentId)).toContain('doc_entity_match');
  });
});
