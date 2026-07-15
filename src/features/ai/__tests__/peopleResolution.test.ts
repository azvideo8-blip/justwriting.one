import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getLocalDb } from '../../../core/storage/localDb';
import { AIPeopleService } from '../services/AIPeopleService';
import { lemmatizeRussianName } from '../utils/temporalQueryParser';

vi.mock('../services/AIService', () => ({
  AIService: {
    embed: vi.fn().mockResolvedValue({
      ok: true,
      vectors: [new Array(1536).fill(0.1)],
    }),
  },
}));

describe('people resolution & consent (MEM-2)', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    await db.clear('aiPeopleIndex');
    await db.clear('documents');
  });

  it('correctly updates and gets status in IndexedDB', async () => {
    await AIPeopleService.updateStatus('иван', 'Иван', 'active');
    
    const db = await getLocalDb();
    const ivan = await db.get('aiPeopleIndex', 'иван');
    expect(ivan).toBeDefined();
    expect(ivan?.name).toBe('Иван');
    expect(ivan?.status).toBe('active');

    await AIPeopleService.updateStatus('иван', 'Иван', 'ignored');
    const updated = await db.get('aiPeopleIndex', 'иван');
    expect(updated?.status).toBe('ignored');
  });

  it('lemmatizes Russian names properly', () => {
    expect(lemmatizeRussianName('Ивана')).toBe('Иван');
    expect(lemmatizeRussianName('Саше')).toBe('Саша');
  });

  it('filters out ignored notes from search results', async () => {
    const db = await getLocalDb();
    
    await db.put('documents', {
      id: 'doc_ignored',
      title: 'Встреча с Иваном',
      content: 'Обсуждали проект с Иваном сегодня.',
      lastSessionAt: Date.now(),
      version: 1,
    } as any);

    await db.put('documents', {
      id: 'doc_active',
      title: 'Работа',
      content: 'Обычный рабочий день без Ивана.',
      lastSessionAt: Date.now(),
      version: 1,
    } as any);

    await AIPeopleService.updateStatus('иван', 'Иван', 'ignored');
    
    const ivan = await db.get('aiPeopleIndex', 'иван');
    if (ivan) {
      ivan.noteIds = ['doc_ignored'];
      await db.put('aiPeopleIndex', ivan);
    }

    const ignoredDocIds = new Set<string>();
    const person = await db.get('aiPeopleIndex', 'иван');
    if (person?.status === 'ignored') {
      person.noteIds.forEach(id => ignoredDocIds.add(id));
    }

    expect(ignoredDocIds.has('doc_ignored')).toBe(true);

    const { searchNotes } = await import('../utils/noteRetriever');
    const results = await searchNotes('Иван', 5, {
      ignoredDocIds,
    });
    
    const ids = results.map(r => r.documentId);
    expect(ids).not.toContain('doc_ignored');
  });
});
