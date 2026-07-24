import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetDbInstance } from '../../../../core/storage/localDb';

const { mockEmbed } = vi.hoisted(() => ({
  mockEmbed: vi.fn(),
}));

vi.mock('../AIService', () => ({
  AIService: {
    embed: mockEmbed,
  },
}));

import {
  AIThemeLedgerService,
  extractVerbatimSentence,
  calculateEmotionalWeight,
} from '../AIThemeLedgerService';


describe('AIThemeLedgerService (C2-scaffold / Theme Ledger)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetDbInstance();
    try {
      const { getLocalDb } = await import('../../../../core/storage/localDb');
      const db = await getLocalDb();
      await db.clear('aiThemeLedger');
    } catch {
      /* ignore */
    }

    // Default embedding mock returns identical vector for similar themes
    mockEmbed.mockImplementation(async ({ content }: { content: string }) => {
      const lower = content.toLowerCase();
      if (lower.includes('тревог') || lower.includes('страх')) {
        return { ok: true, vectors: [[1.0, 0.0, 0.0, 0.0]] };
      }
      if (lower.includes('работа') || lower.includes('карьер')) {
        return { ok: true, vectors: [[0.0, 1.0, 0.0, 0.0]] };
      }
      if (lower.includes('природ')) {
        return { ok: true, vectors: [[0.0, 0.0, 1.0, 0.0]] };
      }
      if (lower.includes('чтение')) {
        return { ok: true, vectors: [[0.0, 0.0, 0.0, 1.0]] };
      }
      return { ok: true, vectors: [[0.5, 0.5, 0.5, 0.5]] };
    });
  });


  describe('extractVerbatimSentence & calculateEmotionalWeight helpers', () => {
    it('extracts verbatim sentence from note matching theme', () => {
      const note = 'Сегодня был тяжелый день. Я чувствую сильную тревогу за будущее. Кот уснул на диване.';
      const sentence = extractVerbatimSentence(note, 'тревога за будущее');
      expect(sentence).toBe('Я чувствую сильную тревогу за будущее.');
    });

    it('calculates emotionalWeight as clamp01(max(|valence|, arousal))', () => {
      expect(calculateEmotionalWeight(-0.8, 0.4)).toBe(0.8);
      expect(calculateEmotionalWeight(0.2, 0.9)).toBe(0.9);
      expect(calculateEmotionalWeight(-1.5, 0.5)).toBe(1.0);
    });
  });

  describe('C2 Scaffold Golden-Set Harness (~10 synthetic notes)', () => {
    const SYNTHETIC_CORPUS = [
      {
        id: 'n1',
        eventDate: '2026-07-01',
        noteDate: '2026-07-24', // saved later!
        content: 'Впервые почувствовал сильную тревогу за будущее из-за работы.',
        themes: ['тревога за будущее'],
        valence: -0.7,
        arousal: 0.6,
      },
      {
        id: 'n2',
        eventDate: '2026-07-03',
        noteDate: '2026-07-24',
        content: 'Готовился к собеседованию. Поиски работы требуют много сил.',
        themes: ['поиск работы'],
        valence: 0.1,
        arousal: 0.3,
      },
      {
        id: 'n3',
        eventDate: '2026-07-05',
        noteDate: '2026-07-24',
        content: 'Опять накатывает тревога за будущее, особенно по вечерам.',
        themes: ['тревога за будущее'],
        valence: -0.6,
        arousal: 0.5,
      },
      {
        id: 'n4',
        eventDate: '2026-07-08',
        noteDate: '2026-07-24',
        content: 'Гулял в парке. Настроение отличное.',
        themes: ['отдых на природе'],
        valence: 0.8,
        arousal: 0.4,
      },
      {
        id: 'n5',
        eventDate: '2026-07-10',
        noteDate: '2026-07-24',
        content: 'Вновь беспокоит тревога за будущее перед встречей с руководителем.',
        themes: ['тревога за будущее'],
        valence: -0.9,
        arousal: 0.8,
      },
      {
        id: 'n6',
        eventDate: '2026-07-12',
        noteDate: '2026-07-24',
        content: 'Отправил резюме на новую вакансию. Карьерный рост важен.',
        themes: ['поиск работы'],
        valence: 0.4,
        arousal: 0.5,
      },
      {
        id: 'n7',
        eventDate: '2026-07-15',
        noteDate: '2026-07-24',
        content: 'Читать книги по вечерам помогает расслабиться.',
        themes: ['чтение'],
        valence: 0.5,
        arousal: 0.2,
      },
      {
        id: 'n8',
        eventDate: '2026-07-18',
        noteDate: '2026-07-24',
        content: 'Очередной этап собеседования пройден.',
        themes: ['поиск работы'],
        valence: 0.6,
        arousal: 0.7,
      },
      {
        id: 'n9',
        eventDate: '2026-07-20',
        noteDate: '2026-07-24',
        content: 'Иногда меня охватывает тревога за будущее, но я справляюсь.',
        themes: ['тревога за будущее'],
        valence: -0.4,
        arousal: 0.3,
      },
      {
        id: 'n10',
        eventDate: '2026-07-22',
        noteDate: '2026-07-24',
        content: 'Получил оффер! Наконец-то этап поиска работы завершен.',
        themes: ['поиск работы'],
        valence: 0.9,
        arousal: 0.9,
      },
    ];

    it('processes write-path and verifies C2 invariants: firstSeenAt, count, verbatim evidence', async () => {
      // Execute write-path for all synthetic notes
      for (const note of SYNTHETIC_CORPUS) {
        await AIThemeLedgerService.touchThemes({
          documentId: note.id,
          themes: note.themes,
          eventDate: note.eventDate,
          valence: note.valence,
          arousal: note.arousal,
          noteContent: note.content,
        });
      }

      const allRecords = await AIThemeLedgerService.getAll();
      expect(allRecords.length).toBe(4); // 4 distinct themes: тревога за будущее, поиск работы, отдых на природе, чтение

      // 1. Check "тревога за будущее"
      const anxietyTheme = allRecords.find(r => r.theme.includes('тревога'));
      expect(anxietyTheme).toBeDefined();
      // Invariant 1: firstSeenAt MUST be eventDate of earliest note (2026-07-01), NOT creation/saved date (2026-07-24)
      expect(anxietyTheme?.firstSeenAt).toBe('2026-07-01');
      expect(anxietyTheme?.lastReinforcedAt).toBe('2026-07-20');

      // Invariant 2: theme repetition increments count (4 notes for anxiety), NO duplicate record created
      expect(anxietyTheme?.count).toBe(4);

      // Invariant 3: evidence stores verbatim sentence from note
      expect(anxietyTheme?.evidence[0]?.sentence).toBe('Впервые почувствовал сильную тревогу за будущее из-за работы.');
      expect(anxietyTheme?.evidence[0]?.noteId).toBe('n1');

      // Check emotionalWeight = clamp01(max(|valence|, arousal))
      // Max for anxiety was note n5: max(|-0.9|, 0.8) = 0.9
      expect(anxietyTheme?.emotionalWeight).toBeCloseTo(0.9);

      // 2. Check "поиск работы"
      const workTheme = allRecords.find(r => r.theme.includes('поиск'));
      expect(workTheme).toBeDefined();
      expect(workTheme?.firstSeenAt).toBe('2026-07-03');
      expect(workTheme?.lastReinforcedAt).toBe('2026-07-22');
      expect(workTheme?.count).toBe(4);
      expect(workTheme?.evidence[0]?.sentence).toBe('Поиски работы требуют много сил.');
    });
  });

  describe('AG-MIND-W1a-fix: Embed Caching & Dedup', () => {
    it('makes 0 AIService.embed calls when touching an already-known theme string', async () => {
      mockEmbed.mockClear();

      // 1. Initial touch creates theme with vector
      await AIThemeLedgerService.touchThemes({
        documentId: 'doc-cache-1',
        themes: ['тревога за будущее'],
        eventDate: '2026-07-24',
        noteContent: 'Впервые почувствовал тревогу за будущее.',
      });
      expect(mockEmbed).toHaveBeenCalledTimes(1);

      mockEmbed.mockClear();

      // 2. Second touch with exact same normalized theme string
      await AIThemeLedgerService.touchThemes({
        documentId: 'doc-cache-2',
        themes: ['ТРЕВОГА ЗА БУДУЩЕЕ  '],
        eventDate: '2026-07-24',
        noteContent: 'Опять тревога за будущее.',
      });

      // MUST be 0 embed calls because vector was cached from IDB record!
      expect(mockEmbed).toHaveBeenCalledTimes(0);
    });

    it('processes bulk notes with repeated themes calling embed only for unique new theme strings', async () => {
      mockEmbed.mockClear();

      const notes = [
        { id: 'b1', themes: ['работа'] },
        { id: 'b2', themes: ['работа'] },
        { id: 'b3', themes: ['работа'] },
        { id: 'b4', themes: ['чтение'] },
        { id: 'b5', themes: ['чтение'] },
      ];

      for (const n of notes) {
        await AIThemeLedgerService.touchThemes({
          documentId: n.id,
          themes: n.themes,
          eventDate: '2026-07-24',
          noteContent: `Заметка на тему ${n.themes[0]}`,
        });
      }

      // Unique themes: 'работа', 'чтение' -> total 2 embed calls, NOT 5!
      expect(mockEmbed).toHaveBeenCalledTimes(2);
    });
  });

  describe('Non-destructive IDB Upgrade (v15 -> v16)', () => {

    it('preserves existing v15 stores and data when upgrading to v16', async () => {
      const { openDB } = await import('idb');
      const testDbName = 'justwriting-local-upgrade-test';

      // 1. Create DB at version 15 with v15 upgrade logic and populate data
      const db15 = await openDB(testDbName, 15, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('documents')) {
            db.createObjectStore('documents', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('aiSummaries')) {
            db.createObjectStore('aiSummaries', { keyPath: 'documentId' });
          }
        },
      });

      await db15.put('documents', { id: 'existing-doc-1', title: 'Old Note', currentVersion: 1 } as any);
      await db15.put('aiSummaries', { documentId: 'existing-doc-1', tone: 'calm', themes: ['old theme'] } as any);
      db15.close();

      // 2. Open DB at v16 with the v16 upgrade block from localDb.ts
      const db16 = await openDB(testDbName, 16, {
        upgrade(db, oldVersion) {
          if (oldVersion < 16) {
            if (!db.objectStoreNames.contains('aiThemeLedger')) {
              const themeStore = db.createObjectStore('aiThemeLedger', { keyPath: 'id' });
              themeStore.createIndex('by-tier', 'tier');
              themeStore.createIndex('by-lastReinforcedAt', 'lastReinforcedAt');
            }
          }
        },
      });

      // 3. Verify store version, new store creation, and existing data integrity
      expect(db16.version).toBe(16);
      expect(db16.objectStoreNames.contains('aiThemeLedger')).toBe(true);

      const oldDoc = await db16.get('documents', 'existing-doc-1');
      expect(oldDoc).toEqual(expect.objectContaining({ id: 'existing-doc-1', title: 'Old Note' }));

      const oldSummary = await db16.get('aiSummaries', 'existing-doc-1');
      expect(oldSummary).toEqual(expect.objectContaining({ documentId: 'existing-doc-1', tone: 'calm' }));
      db16.close();
    });
  });

});

