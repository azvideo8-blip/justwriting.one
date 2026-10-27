import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { NoteAnalysisService } from '../NoteAnalysisService';
import { AISummaryService } from '../AISummaryService';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { AICommitmentService } from '../AICommitmentService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalStoreSyncService } from '../../../../core/services/LocalStoreSyncService';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: vi.fn(() => null) }));

// N-4: исключение/удаление заметки чистит не только сводку и вектор, но и всё,
// где лежат её дословные предложения, — локально и (через очередь) в облаке.
describe('N-4: a note leaves no derivatives behind', () => {
  it('clears timeline, commitments, theme evidence, life story and belief evidence', async () => {
    vi.spyOn(AISummaryService, 'delete').mockResolvedValue(undefined as never);
    vi.spyOn(AIEmbeddingService, 'delete').mockResolvedValue(undefined as never);
    const del = vi.spyOn(LocalStoreSyncService, 'scheduleStoreDelete').mockImplementation(() => {});
    vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync').mockImplementation(() => {});
    const db = await getLocalDb();
    const D = 'doc_x', O = 'doc_other';
    await db.put('documents', { id: D, uuid: 'uuid_x', guestId: 'g', title: '', currentVersion: 1, totalWords: 1, totalDuration: 1, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [] });
    await db.put('aiTimeline', { documentId: D, date: '2026-09-01', month: '2026-09', facts: ['секрет'] });
    await db.put('aiCommitments', { id: 'c1', text: 'позвонить маме', documentId: D, createdAt: 1, date: '2026-09-01', status: 'open' });
    await db.put('aiCommitments', { id: 'c2', text: 'чужое', documentId: O, createdAt: 1, date: '2026-09-01', status: 'open' });
    await db.put('aiThemeLedger', { id: 't1', theme: 'усталость', themeVector: [], firstSeenAt: '', evidence: [{ noteId: D, eventDate: '', sentence: 'дословно' }, { noteId: O, eventDate: '', sentence: 'другое' }], count: 2, lastReinforcedAt: '', emotionalWeight: 0, tier: 'active' });
    await db.put('aiThemeLedger', { id: 't2', theme: 'только эта', themeVector: [], firstSeenAt: '', evidence: [{ noteId: D, eventDate: '', sentence: 'дословно' }], count: 1, lastReinforcedAt: '', emotionalWeight: 0, tier: 'active' });
    await db.put('lifeStory', { eventDate: '2026-09-01', text: 'пересказ', sourceDocumentIds: [D], generatedAt: 1 });
    await db.put('aiBeliefs', { id: 'b1', belief: 'я устал', evidence: [{ id: `timeline-${D}-0` }, { id: 'mem1' }], unitIds: [`timeline-${D}-0`, 'mem1'] });

    await NoteAnalysisService.clear(D);

    expect(await db.get('aiTimeline', D)).toBeUndefined();
    expect((await db.getAll('aiCommitments')).map(c => c.id)).toEqual(['c2']);
    expect((await db.get('aiThemeLedger', 't1'))?.evidence.map(e => e.noteId)).toEqual([O]);
    expect(await db.get('aiThemeLedger', 't2')).toBeUndefined();
    expect(await db.get('lifeStory', '2026-09-01')).toBeUndefined();
    expect(await db.get('aiBeliefs', 'b1')).toBeUndefined();
    expect(del).toHaveBeenCalledWith('aiBeliefs', 'b1');
    expect(del).toHaveBeenCalledWith('aiTimeline', D);
    expect(del).toHaveBeenCalledWith('aiThemeLedger', 't2');
  });

  it('open commitments of a note hidden from AI do not reach the chat', async () => {
    const db = await getLocalDb();
    await db.clear('aiCommitments');
    await db.put('documents', { id: 'doc_h', guestId: 'g', title: '', currentVersion: 1, totalWords: 1, totalDuration: 1, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [], excludedFromAI: true });
    await db.put('aiCommitments', { id: 'c3', text: 'скрытое', documentId: 'doc_h', createdAt: Date.now(), date: '2026-09-01', status: 'open' });
    // Ревью 0.10.13: видимая — это заметка, которая есть и не скрыта; «нет в documents» = не видна.
    await db.put('documents', { id: 'doc_other', guestId: 'g', title: '', currentVersion: 1, totalWords: 1, totalDuration: 1, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [] });
    await db.put('aiCommitments', { id: 'c4', text: 'видимое', documentId: 'doc_other', createdAt: Date.now(), date: '2026-09-01', status: 'open' });
    expect((await AICommitmentService.getOpenCommitments()).map(c => c.id)).toEqual(['c4']);
  });
});
