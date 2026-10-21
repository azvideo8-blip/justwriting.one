import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, type LocalDocument } from '../../../../core/storage/localDb';
import { getCurrentUser } from '../../../../core/auth';
import { _resetAuthStateForTesting } from '../../../../core/auth/supabaseAuthProvider';
import { DataProvider } from '../../../../core/data';
import { setIndexingConsent } from '../../../../core/ai/indexingConsent';
import { emitDomainEvent, type DomainEvent } from '../../../../core/events/domainEvents';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { initAiDomainEvents } from '../../subscribeDomainEvents';
import { AIService } from '../../services/AIService';
import { getMiniSearch, invalidateMiniSearchCache, keywordSearch, refreshMiniSearchDoc } from '../retrieval/indexCache';
import { searchNotes } from '../retrieval/searchNotes';
import { searchNotesMulti } from '../retrieval/searchNotesMulti';

const auth = vi.hoisted(() => ({ callback: (_event: string, _session: unknown) => {} }));
vi.mock('../../../../core/supabase/client', () => ({
  getSupabase: () => ({ auth: {
    onAuthStateChange: (callback: typeof auth.callback) => {
      auth.callback = callback;
      return { data: { subscription: { unsubscribe() {} } } };
    },
  } }),
}));

const uid = 'ap2-rerank-user';
const hidden = 'a-hidden';
const visible = 'b-visible';
const marker = 'AP2_RERANK_PRIVATE';
const doc = (id: string): LocalDocument => ({
  id, uuid: `uuid-${id}`, guestId: uid, title: id === hidden ? marker : 'Видимая запись',
  currentVersion: 1, totalWords: 20, totalDuration: 1, sessionsCount: 1,
  firstSessionAt: 1, lastSessionAt: 1, tags: [],
});
async function seed(id: string) {
  const db = await getLocalDb();
  await db.put('documents', doc(id));
  await db.put('versions', { id: `v-${id}`, documentId: id, version: 1,
    content: `прогресс развитие ${id === hidden ? marker : 'AP2_RERANK_VISIBLE'}`, guestId: uid,
    savedAt: 1, sessionStartedAt: 1, wordCount: 10, wordsAdded: 10, charsAdded: 50, duration: 1, wpm: 10 });
}
let unsubscribe = () => {};
beforeEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  _resetAuthStateForTesting();
  getCurrentUser();
  auth.callback('SIGNED_IN', { user: { id: uid } });
  expect(getCurrentUser()?.uid).toBe(uid);
  setIndexingConsent(uid, 'granted');
  invalidateMiniSearchCache();
  const db = await getLocalDb();
  for (const store of ['documents', 'versions', 'aiSummaries', 'aiTimeline', 'aiEmbeddings', 'aiBeliefs',
    'aiChatMemory', 'aiCommitments', 'aiThemeLedger', 'lifeStory', 'aiProfileFacets', 'aiPortrait', 'aiMonthlyDigest'] as const) await db.clear(store);
  await seed(hidden);
  await seed(visible);
  vi.spyOn(DataProvider, 'deleteEmbedding').mockResolvedValue(undefined);
  vi.spyOn(DataProvider, 'deleteSummary').mockResolvedValue(undefined);
  unsubscribe = initAiDomainEvents();
});
afterEach(() => {
  unsubscribe();
  invalidateMiniSearchCache();
  _resetAuthStateForTesting();
  vi.restoreAllMocks();
});

const paths = [
  { name: 'одиночный', run: () => searchNotes('прогресс', 5, { queryVector: [1, 0], allEmbeddings: [] }) },
  { name: 'мульти', run: () => searchNotesMulti(['прогресс', 'развитие'], 5, { queryVector: [1, 0], allEmbeddings: [] }) },
];

describe('AP2-2: настоящий MiniSearch и обработчик скрытия', () => {
  for (const path of paths) {
    it.each(['note.excludedFromAI', 'note.trashed'] as const)(`${path.name}: окно clear, %s`, async type => {
      const db = await getLocalDb();
      const index = await getMiniSearch(uid);
      expect(index.has(hidden)).toBe(true);
      let release = () => {};
      const blocked = new Promise<void>(resolve => { release = resolve; });
      const cloud = vi.spyOn(DataProvider, 'deleteSummary').mockReturnValue(blocked);
      const rerank = vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: true, documentIds: [visible] });
      await db.put('documents', { ...doc(hidden), ...(type === 'note.trashed' ? { trashedAt: 1 } : { excludedFromAI: true }) });
      emitDomainEvent({ type, documentId: hidden, excluded: true } as DomainEvent);
      try {
        await vi.waitFor(() => expect(cloud).toHaveBeenCalled());
        await path.run();
        expect(rerank).toHaveBeenCalledOnce();
        expect(JSON.stringify(rerank.mock.calls)).toContain('AP2_RERANK_VISIBLE');
        expect(JSON.stringify(rerank.mock.calls)).not.toContain(marker);
        expect((await keywordSearch('прогресс', 10, uid)).map(m => m.id)).not.toContain(hidden);
      } finally {
        release();
        await vi.waitFor(() => expect(DataProvider.deleteEmbedding).toHaveBeenCalled());
      }
    });
  }

  // Ревью AP2 L5: карточки строятся из снимка документов, снятого до чтения
  // текста; заметку, скрытую в этот момент, отсекает перечитывание видимости.
  for (const path of paths) {
    it(`${path.name}: скрыли, пока строились карточки — в реранк не уходит`, async () => {
      await getMiniSearch(uid);
      const db = await getLocalDb();
      const read = LocalVersionService.getLatestContent.bind(LocalVersionService);
      vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async id => {
        if (id === hidden) await db.put('documents', { ...doc(hidden), excludedFromAI: true });
        return read(id);
      });
      const rerank = vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: true, documentIds: [visible] });
      await path.run();
      expect(rerank).toHaveBeenCalledOnce();
      expect(JSON.stringify(rerank.mock.calls)).toContain('AP2_RERANK_VISIBLE');
      expect(JSON.stringify(rerank.mock.calls)).not.toContain(marker);
    });
  }

  it('первая сборка, начатая до скрытия, не попадает в кэш', async () => {
    for (let i = 0; i < 250; i++) await seed(`filler-${i}`);
    const reading = vi.spyOn(LocalVersionService, 'getLatestContent');
    let built = false;
    const building = getMiniSearch(uid).then(ms => { built = true; return ms; });
    await vi.waitFor(() => expect(reading).toHaveBeenCalledWith(hidden), { interval: 1 });
    expect(built).toBe(false);
    const db = await getLocalDb();
    await db.put('documents', { ...doc(hidden), excludedFromAI: true });
    emitDomainEvent({ type: 'note.excludedFromAI', documentId: hidden, excluded: true });
    await vi.waitFor(() => expect(DataProvider.deleteEmbedding).toHaveBeenCalled(), { interval: 1 });
    await building;
    const rerank = vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: true, documentIds: [visible] });
    await paths[1]!.run();
    expect(rerank).toHaveBeenCalledOnce();
    expect(JSON.stringify(rerank.mock.calls)).not.toContain(marker);
    expect((await getMiniSearch(uid)).has(hidden)).toBe(false);
  });

  // Ревью AP2: общий счётчик поколений в точечном обновлении ронял соседнюю
  // заметку — ConflictResolver шлёт два обновления подряд.
  it('два точечных обновления подряд не выбрасывают видимые заметки из индекса', async () => {
    const ms = await getMiniSearch(uid);
    await Promise.all([refreshMiniSearchDoc(hidden, uid), refreshMiniSearchDoc(visible, uid)]);
    expect(ms.has(hidden)).toBe(true);
    expect(ms.has(visible)).toBe(true);
  });

  it('заметку скрыли, пока точечное обновление читало текст — в индекс она не возвращается', async () => {
    const ms = await getMiniSearch(uid);
    const db = await getLocalDb();
    const read = LocalVersionService.getLatestContent.bind(LocalVersionService);
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementationOnce(async id => {
      await db.put('documents', { ...doc(hidden), excludedFromAI: true });
      return read(id);
    });
    await refreshMiniSearchDoc(hidden, uid);
    expect(ms.has(hidden)).toBe(false);
  });
});
