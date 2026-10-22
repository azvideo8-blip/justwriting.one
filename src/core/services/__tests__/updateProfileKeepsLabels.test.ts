import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { LocalDocumentService } from '../LocalDocumentService';

// EA-6: пересчёт счётчиков профиля стирал метки (их пишет импорт архива)
// при каждом удалении заметки — голый put без остальных полей.
describe('LocalDocumentService._updateProfile (EA-6)', () => {
  it('keeps labels while recomputing totals', async () => {
    // LG-1: база аккаунта, где _updateProfile и читает, — в общей тест проверял
    // строку, которую никто не трогал, и не краснел.
    const db = await getLocalDb('u_labels');
    const labels = [{ id: 'l1', name: 'Работа', color: '#3B6BB5' }];
    await db.put('profile', { guestId: 'u_labels', totalWords: 0, sessionsCount: 0, totalDuration: 0, lastSessionAt: 1, labels } as never);
    await LocalDocumentService._updateProfile('u_labels');
    expect((await db.get('profile', 'u_labels'))?.labels).toEqual(labels);
  });
});
