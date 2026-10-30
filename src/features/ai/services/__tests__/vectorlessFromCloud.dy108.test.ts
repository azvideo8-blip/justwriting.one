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

import { AIThemeLedgerService } from '../AIThemeLedgerService';
import { AICommitmentService } from '../AICommitmentService';
import { buildAggregateThemeBlock } from '../chatContext/aggregateStats';

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
  it('(a) повтор темы из облака подкрепляет её и возвращает вектор, а не плодит дубль', async () => {
    const db = await getLocalDb();
    await db.put('aiThemeLedger', {
      id: 't1', theme: 'Тревога за будущее', themeVector: [], firstSeenAt: '2026-10-01',
      lastReinforcedAt: '2026-10-01', lastReinforcedAtMs: 1, count: 3, emotionalWeight: 0.5,
      sensitivity: 'normal', tier: 'active', evidence: [],
    });
    await AIThemeLedgerService.touchThemes({
      documentId: 'n1', themes: ['тревога за будущее'], eventDate: '2026-10-30',
      noteContent: 'Опять тревога за будущее.',
    });
    const all = await db.getAll('aiThemeLedger');
    expect(all).toHaveLength(1);
    expect(all[0]!.count).toBe(4);
    expect(all[0]!.themeVector).toEqual(V);
  });

  it('(b) статистика находит тему без вектора по имени в вопросе', async () => {
    const db = await getLocalDb();
    await db.put('aiThemeLedger', {
      id: 't2', theme: 'бег', themeVector: [], firstSeenAt: '2026-10-01',
      lastReinforcedAt: '2026-10-20', lastReinforcedAtMs: 1, count: 7, emotionalWeight: 0.2,
      sensitivity: 'normal', tier: 'active', evidence: [],
    });
    const block = await buildAggregateThemeBlock({
      effectiveQuery: 'сколько раз я писал про бег?', queryEmb: [0, 1, 0, 0], uid: 'u_dy108v', onDailyLimitError: () => {},
    });
    expect(block).toContain('Тема "бег": упоминалась 7 раз');
  });

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
