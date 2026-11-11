// DY10-8, ревью 0.11.2: вектор в облако не едет — тема и план, приехавшие на
// новое устройство, без вектора. Раньше: каждый повтор известной темы шёл в
// «новую тему» (дубли, счёт делится), статистика по теме всегда «нет данных»,
// план никогда не закрывался.
// Мутации: убрать сверку темы по имени → (a) красный; вернуть +0.2 для темы
// без вектора → (b) красный; убрать возврат вектора плану → (c) красный.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLocalDb, resetDbInstance } from '../../../../core/storage/localDb';

const { mockEmbed } = vi.hoisted(() => ({ mockEmbed: vi.fn() }));

vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_dy108v' }) }));
vi.mock('../../../../core/ai/indexingConsent', () => ({ hasIndexingConsent: () => true }));
vi.mock('../AIService', () => ({ AIService: { embed: mockEmbed } }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({
  LocalStoreSyncService: { scheduleStoreSync: vi.fn() },
}));

import { AICommitmentService } from '../AICommitmentService';

const V = [1, 0, 0, 0];

beforeEach(async () => {
  vi.clearAllMocks();
  resetDbInstance();
  mockEmbed.mockResolvedValue({ ok: true, vectors: [V] });
  const db = await getLocalDb();
  await db.clear('aiThemeLedger');
  await db.clear('aiCommitments');
  await db.clear('documents');
  await db.put('documents', {
    id: 'n1', guestId: 'u_dy108v', title: 'n1', currentVersion: 1, totalWords: 10,
    totalDuration: 1, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [],
  });
});

describe('DY10-8: записи из облака без вектора', () => {


  it('(c) тот же план из облака получает вектор обратно — иначе не закроется', async () => {
    const db = await getLocalDb();
    await db.put('aiCommitments', {
      id: 'c1', text: 'Позвонить маме', documentId: 'n1', createdAt: 1, date: '2026-10-01', status: 'open',
    });
    await AICommitmentService.upsertCommitments('n1', ['позвонить маме'], '2026-10-30');
    const all = await db.getAll('aiCommitments');
    expect(all).toHaveLength(1);
    expect(all[0]!.vector).toEqual(V);
  });
});
