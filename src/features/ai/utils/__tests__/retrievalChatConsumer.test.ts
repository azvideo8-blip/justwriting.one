// AUDIT-part3 4: приёмка потребителя «чат». aiChatContext зовёт
// searchNotesMulti + vectorScore01 из распилённого retrieval/ — этот тест
// гоняет РЕАЛЬНЫЙ пайплайн (fake-indexeddb, без мока поиска) тем же путём,
// каким ходит чат: multi-query fusion → loadNotes → RetrievedNote.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { searchNotesMulti, vectorScore01, type RetrievedNote } from '../noteRetriever';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';

async function seedDoc(id: string, title: string, contentText: string): Promise<void> {
  contents.set(id, contentText);
  const db = await getLocalDb();
  await db.put('documents', {
    id, guestId: 'u1', title, currentVersion: 1,
    totalWords: 20, totalDuration: 0, sessionsCount: 1,
    firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
  } as never);
}

const contents = new Map<string, string>();

describe('chat consumer journey through split retrieval/ (AUDIT-part3 4)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    // restoreAllMocks снимает прошлый spy — навешиваем заново на каждый тест.
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(
      async (docId: string) => contents.get(docId) ?? '',
    );
    const db = await getLocalDb();
    for (const store of ['documents', 'versions'] as const) {
      for (const rec of await db.getAll(store)) await db.delete(store, (rec as { id: string }).id);
    }
  });

  it('searchNotesMulti (chat path) fuses keyword results across query variants', async () => {
    await seedDoc('note_work', 'Про работу', 'Текст про работу и дедлайны на проекте.');
    await seedDoc('note_garden', 'Про сад', 'Заметка о рассаде томатов и грядках.');

    // Точно как в aiChatContext.ts:666 — массив вариантов запроса.
    const result = await searchNotesMulti(['работа дедлайны'], 5);
    const notes: RetrievedNote[] = result.notes;
    expect(result.failed).toBe(false);

    // Инвариант контракта чата: массив заметок с непустыми id и числовым score.
    expect(Array.isArray(notes)).toBe(true);
    for (const n of notes) {
      expect(typeof n.documentId).toBe('string');
      expect(typeof n.score).toBe('number');
    }
    // Релевантная заметка найдена keyword-веткой и дошла до чата.
    expect(notes.some(n => n.documentId === 'note_work')).toBe(true);
  });

  it('multi-query variants are all fused into one ranked list without duplicates', async () => {
    await seedDoc('note_k', 'Керамика', 'Мастерская керамической посуды и обжиг.');
    const { notes } = await searchNotesMulti(['керамика', 'обжиг'], 5);
    const ids = notes.map(n => n.documentId);
    expect(new Set(ids).size).toBe(ids.length); // дублей слияния нет
  });

  it('vectorScore01 keeps the chat-side normalization contract', () => {
    expect(vectorScore01(0)).toBe(0);
    expect(vectorScore01(0.02)).toBeGreaterThan(0);
    expect(vectorScore01(10)).toBeLessThanOrEqual(1); // насыщение
  });
});
