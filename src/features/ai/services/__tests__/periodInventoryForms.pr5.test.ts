// PR-5 (17.4): перечень периода узнавал только «все/всё/перечисли/список/
// каждый/за весь». Живые формы «по каждой», «каждую», «всех», «пройдись по
// записям» не включали перечень, и ответ шёл по топу поиска.
//
// Мутация: убрать новые формы из LIST_WORDS → красные.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { buildTemporalBlocks } from '../chatContext/temporalBlocks';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const OCT_1 = Date.UTC(2026, 9, 1);

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiTimeline'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  await db.put('documents', {
    id: 'local_pr5_a', guestId: 'u1', title: 'Запись', currentVersion: 1,
    firstSessionAt: OCT_1, lastSessionAt: OCT_1, tags: [],
  } as never);
  await db.put('aiSummaries', {
    documentId: 'local_pr5_a', processedAt: OCT_1, summary: 'СУТЬ_ПР5', themes: [], insights: [], extractedFacts: [],
  } as never);
}

async function block(text: string): Promise<string> {
  const res = await buildTemporalBlocks({
    text, effectiveQuery: text, explicitSearch: false, lastSearchQuery: '', db: await getLocalDb(),
  });
  return res.appended;
}

const FORMS = [
  'что было в каждой записи за октябрь 2026',
  'покажи каждую запись за октябрь 2026',
  'содержание каждого дня за октябрь 2026',
  'каждое осознание за октябрь 2026',
  'содержание всех записей за октябрь 2026',
  'расскажи по всем записям за октябрь 2026',
  'пройдись по записям за октябрь 2026',
  'пробегись по каждой за октябрь 2026',
];

describe('PR-5: живые формы просьбы о перечне', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it.each(FORMS)('«%s» — перечень', async (text) => {
    await seed();
    expect(await block(text)).toContain('[Все записи периода');
  });

  it('слово «всё» вне хода периода перечень не тянет', async () => {
    await seed();
    const text = await block('мне всё равно, что было');
    expect(text).not.toContain('[Все записи периода');
  });
});
