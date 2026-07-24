import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getLocalDb, AIDocumentSummary } from '../../../../core/storage/localDb';
import { AILexiconService } from '../AILexiconService';
import { AIService } from '../AIService';

describe('AILexiconService', () => {
  beforeEach(async () => {
    AILexiconService.clearCache();
    const db = await getLocalDb();
    await db.clear('aiSummaries');
    vi.restoreAllMocks();
  });

  it('returns null when overall signal is insufficient (frequentWords in only 1 month)', async () => {
    const db = await getLocalDb();

    // 5 summaries, but all in the same month (2026-07)
    for (let i = 1; i <= 5; i++) {
      const summary: AIDocumentSummary = {
        documentId: `doc_${i}`,
        processedAt: Date.parse(`2026-07-0${i}T10:00:00Z`),
        eventDate: `2026-07-0${i}`,
        tone: 'рефлексивный',
        frequentWords: ['залипание', 'мысль', 'и', 'в'],
        insights: [],
        themes: [],
        extractedFacts: [],
      };
      await db.put('aiSummaries', summary);
    }

    const voiceMap = await AILexiconService.getVoiceMap();
    expect(voiceMap).toBeNull();
  });

  it('returns null when total summaries count is below threshold (< 5)', async () => {
    const db = await getLocalDb();

    // 3 summaries across 2 months (below minCount = 5 threshold)
    const dates: string[] = ['2026-06-15', '2026-06-20', '2026-07-01'];
    for (let i = 0; i < dates.length; i++) {
      const dateStr = dates[i] as string;
      const summary: AIDocumentSummary = {
        documentId: `doc_${i}`,
        processedAt: Date.parse(`${dateStr}T10:00:00Z`),
        eventDate: dateStr,
        tone: 'спокойный',
        frequentWords: ['залипание', 'код'],
        insights: [],
        themes: [],
        extractedFacts: [],
      };
      await db.put('aiSummaries', summary);
    }

    const voiceMap = await AILexiconService.getVoiceMap();
    expect(voiceMap).toBeNull();
  });

  it('aggregates terms correctly for dense user (>=5 summaries across >=2 months) and filters stop-words', async () => {
    const db = await getLocalDb();
    const embedSpy = vi.spyOn(AIService, 'embed');

    // 6 summaries across May, June, July 2026
    const summariesData: { id: string; date: string; words: string[] }[] = [
      { id: 'd1', date: '2026-05-10', words: ['Залипание', 'код', 'и', 'в'] },
      { id: 'd2', date: '2026-05-20', words: ['залипание', 'мысль', 'я'] },
      { id: 'd3', date: '2026-06-05', words: ['залипание', 'рефлексия', 'проект'] },
      { id: 'd4', date: '2026-06-15', words: ['рефлексия', 'код', 'the'] },
      { id: 'd5', date: '2026-07-01', words: ['залипание', 'рефлексия', 'проект'] },
      { id: 'd6', date: '2026-07-10', words: ['код', 'мышление'] },
    ];

    for (const s of summariesData) {
      const summary: AIDocumentSummary = {
        documentId: s.id,
        processedAt: Date.parse(`${s.date}T10:00:00Z`),
        eventDate: s.date,
        tone: 'нейтральный',
        frequentWords: s.words,
        insights: [],
        themes: [],
        extractedFacts: [],
      };
      await db.put('aiSummaries', summary);
    }

    const voiceMap = await AILexiconService.getVoiceMap();

    expect(voiceMap).not.toBeNull();
    expect(voiceMap?.terms).toBeDefined();

    // Verify characteristic term "залипание"
    const zalipanie = voiceMap?.terms.find(t => t.word === 'залипание');
    expect(zalipanie).toBeDefined();
    expect(zalipanie?.count).toBe(4);
    expect(zalipanie?.uniqueMonths).toBe(3); // May, June, July

    // Verify stop-words were filtered out
    const stopWordsInMap = voiceMap?.terms.filter(t => ['и', 'в', 'я', 'the'].includes(t.word));
    expect(stopWordsInMap).toHaveLength(0);

    // Verify 0 LLM/embed calls
    expect(embedSpy).not.toHaveBeenCalled();
  });

  it('uses in-memory cache and updates when clearCache is called', async () => {
    const db = await getLocalDb();

    // Setup valid dataset (5 summaries across 2 months)
    const dates: string[] = ['2026-06-10', '2026-06-20', '2026-06-25', '2026-07-05', '2026-07-10'];
    for (let i = 0; i < dates.length; i++) {
      const dateStr = dates[i] as string;
      const summary: AIDocumentSummary = {
        documentId: `doc_${i}`,
        processedAt: Date.parse(`${dateStr}T10:00:00Z`),
        eventDate: dateStr,
        tone: 'спокойный',
        frequentWords: ['фокус', 'проект'],
        insights: [],
        themes: [],
        extractedFacts: [],
      };
      await db.put('aiSummaries', summary);
    }

    const map1 = await AILexiconService.getVoiceMap();
    expect(map1).not.toBeNull();

    // Mutate DB without clearing cache
    await db.clear('aiSummaries');
    const mapCached = await AILexiconService.getVoiceMap();
    expect(mapCached).toBe(map1);

    // Clear cache and request again -> returns null
    AILexiconService.clearCache();
    const mapFresh = await AILexiconService.getVoiceMap();
    expect(mapFresh).toBeNull();
  });
});
