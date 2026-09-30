import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getDocDate } from '../corpusStats';
import { getLocalDb } from '../../../../../core/storage/localDb';

// R4-020: без последней сессии датой записи была «сегодня» — разбор старой
// заметки датировался днём запроса.
describe('getDocDate (R4-020)', () => {
  beforeEach(async () => {
    const db = await getLocalDb();
    for (const rec of await db.getAll('documents')) await db.delete('documents', (rec as { id: string }).id);
  });

  it('падает на firstSessionAt, когда lastSessionAt пуст', async () => {
    const db = await getLocalDb();
    await db.put('documents', {
      id: 'doc_old', title: 'Старая', firstSessionAt: Date.parse('2026-07-29T12:00:00'),
      createdAt: Date.parse('2026-07-29T12:00:00'), updatedAt: Date.parse('2026-07-29T12:00:00'),
    } as never);
    await expect(getDocDate('doc_old')).resolves.toBe('2026-07-29');
  });
});
