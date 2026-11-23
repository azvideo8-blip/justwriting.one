import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { NoteAnalysisService } from '../NoteAnalysisService';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalStoreSyncService } from '../../../../core/services/LocalStoreSyncService';
import { writeFacetStore } from '../../../../core/services/facetLock';
import { markAllAnalysed } from '../../../../test/utils/markAnalysed';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: vi.fn(() => null) }));

// NB-1 (sus12): отказ удаления производной (дайджест/грань/портрет) не глотается:
// clearAnalysis возвращает localFailed, cascade-вход считает отказ в failed.
// Пересказ, оставшийся в IDB, попадает в подсказки ИИ — молчать нельзя.
describe('NB-1 sus12: purge refusal is named', () => {
  const D = 'doc_sus12';
  const MONTH = '2026-09';

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(LocalStoreSyncService, 'scheduleStoreDelete').mockImplementation(() => {});
    vi.spyOn(LocalStoreSyncService, 'scheduleStoreSync').mockImplementation(() => {});
    localStorage.clear();
    const db = await getLocalDb();
    for (const s of ['documents', 'aiSummaries', 'aiEmbeddings', 'aiTimeline', 'aiMonthlyDigest', 'aiProfileFacets', 'aiPortrait'] as const) {
      await db.clear(s);
    }
    await db.put('documents', { id: D, uuid: 'uuid_sus12', guestId: 'guest', title: '', currentVersion: 1, totalWords: 1, totalDuration: 1, sessionsCount: 1, firstSessionAt: 1, lastSessionAt: 1, tags: [] });
    await markAllAnalysed(db);
    await db.put('aiTimeline', { documentId: D, date: '2026-09-01', month: MONTH, facts: ['синтетика'] });
    await db.put('aiMonthlyDigest', { month: MONTH, narrative: 'синтетический пересказ', tones: [], themes: [], noteCount: 1, noteIds: [D], generatedAt: 1 });
    // NARROW-2: грань сеется только через writeFacetStore — сырой db.put запрещён храповиком.
    await writeFacetStore(store => store.put({ id: 'f1', label: 'Тема', summary: 'синтетический пересказ грани', centroid: [], noteIds: [D], noteCount: 1, firstAt: 1, lastAt: 1, updatedAt: 1, buildId: 'b1' }));
    await db.put('aiPortrait', { id: 'singleton', portrait: 'синтетический портрет', updatedAt: 1, generatedAtDelta: 0 });
  });

  function refuseStore(store: string, method: 'delete' | 'getAll') {
    return async () => {
      const db = await getLocalDb();
      const real = db[method].bind(db) as (s: string, k?: IDBValidKey) => Promise<unknown>;
      vi.spyOn(db, method).mockImplementation(((s: string, k?: IDBValidKey) =>
        s === store ? Promise.reject(new Error(`sus12: ${store} ${method} refused`)) : real(s, k)) as never);
    };
  }

  it('digest delete refusal → localFailed, digest stays', async () => {
    await refuseStore('aiMonthlyDigest', 'delete')();
    const db = await getLocalDb();
    const res = await NoteAnalysisService.clearAnalysis(D);
    expect(res.localFailed).toBe(true);
    expect(await db.get('aiMonthlyDigest', MONTH)).toBeDefined();
  });

  it('facets read/write refusal → localFailed, facet keeps the note', async () => {
    await refuseStore('aiProfileFacets', 'getAll')();
    const db = await getLocalDb();
    const res = await NoteAnalysisService.clearAnalysis(D);
    expect(res.localFailed).toBe(true);
    const facet = await db.get('aiProfileFacets', 'f1');
    expect(facet?.noteIds).toContain(D);
    expect(facet?.summary).toBe('синтетический пересказ грани');
  });

  it('portrait delete refusal → localFailed, portrait stays', async () => {
    await refuseStore('aiPortrait', 'delete')();
    const db = await getLocalDb();
    const res = await NoteAnalysisService.clearAnalysis(D);
    expect(res.localFailed).toBe(true);
    expect(await db.get('aiPortrait', 'singleton')).toBeDefined();
  });

  it('control: clean purge → localFailed false, derivatives gone', async () => {
    const db = await getLocalDb();
    const res = await NoteAnalysisService.clearAnalysis(D);
    expect(res).toMatchObject({ cloudSynced: true, localFailed: false });
    expect(await db.get('aiMonthlyDigest', MONTH)).toBeUndefined();
    expect(await db.get('aiProfileFacets', 'f1')).toBeUndefined();
    expect(await db.get('aiPortrait', 'singleton')).toBeUndefined();
  });

  it('cascade entry counts purge refusal as failed', async () => {
    await refuseStore('aiMonthlyDigest', 'delete')();
    const ok = await LocalDocumentService.cascadeDeleteAIDerivatives(D, undefined, undefined, true);
    expect(ok).toBe(false);
  });
});