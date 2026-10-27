// PR-2 (16.2): перечень периода подписывал каждую запись только summary, хотя
// у разбора есть insights и extractedFacts. «Выпиши все осознания за октябрь»
// получал перечень тем, а не осознаний. Скрытая от ИИ запись не должна попасть
// в перечень даже строкой insights.
//
// Мутация: подписывать строки только label (вернуть старый inventoryBlock) →
// красные (1) и (2).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { buildTemporalBlocks } from '../chatContext/temporalBlocks';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const OCT_1 = Date.UTC(2026, 9, 1);
const DAY = 86_400_000;

const DOCS = [
  { id: 'local_pr2_a', day: 2, insight: 'ОЗАРЕНИЕ_А: усталость — не лень.', fact: 'ФАКТ_А: встреча в четверг.', summary: 'СУТЬ_А про встречу.' },
  { id: 'local_pr2_b', day: 9, insight: 'ОЗАРЕНИЕ_Б: просить о помощи можно.', fact: 'ФАКТ_Б: звонок сестре.', summary: 'СУТЬ_Б про звонок.' },
  { id: 'local_pr2_c', day: 18, insight: 'ОЗАРЕНИЕ_В: страх говорит тихо.', fact: 'ФАКТ_В: прогулка вечером.', summary: 'СУТЬ_В про прогулку.' },
];

async function seed() {
  const db = await getLocalDb();
  for (const store of ['documents', 'aiSummaries', 'aiTimeline'] as const) {
    const all = await db.getAll(store);
    for (const rec of all) {
      const key = (rec as { id?: string; documentId?: string }).id ?? (rec as { documentId: string }).documentId!;
      await db.delete(store, key as string);
    }
  }
  for (const n of DOCS) {
    await db.put('documents', {
      id: n.id, guestId: 'u1', title: n.summary, currentVersion: 1,
      firstSessionAt: OCT_1 + (n.day - 1) * DAY, lastSessionAt: OCT_1 + (n.day - 1) * DAY, tags: [],
    } as never);
    await db.put('aiSummaries', {
      documentId: n.id, processedAt: OCT_1, summary: n.summary, themes: [],
      insights: [n.insight], extractedFacts: [n.fact],
    } as never);
  }
  await db.put('documents', {
    id: 'local_pr2_hidden', guestId: 'u1', title: 'скрытая', currentVersion: 1,
    firstSessionAt: OCT_1 + 5 * DAY, lastSessionAt: OCT_1 + 5 * DAY, tags: [], excludedFromAI: true,
  } as never);
  await db.put('aiSummaries', {
    documentId: 'local_pr2_hidden', processedAt: OCT_1, summary: 'СКРЫТАЯ_СУТЬ', themes: [],
    insights: ['СКРЫТОЕ_ОЗАРЕНИЕ'], extractedFacts: ['СКРЫТЫЙ_ФАКТ'],
  } as never);
  await db.put('documents', {
    id: 'local_pr2_trash', guestId: 'u1', title: 'корзина', currentVersion: 1,
    firstSessionAt: OCT_1 + 7 * DAY, lastSessionAt: OCT_1 + 7 * DAY, tags: [], trashedAt: OCT_1,
  } as never);
  await db.put('aiSummaries', {
    documentId: 'local_pr2_trash', processedAt: OCT_1, summary: 'КОРЗИНА_СУТЬ', themes: [],
    insights: ['КОРЗИННОЕ_ОЗАРЕНИЕ'], extractedFacts: ['КОРЗИННЫЙ_ФАКТ'],
  } as never);
}

async function block(text: string): Promise<string> {
  const res = await buildTemporalBlocks({
    text, effectiveQuery: text, explicitSearch: false, lastSearchQuery: '', db: await getLocalDb(),
  });
  return res.appended;
}

describe('PR-2: перечень периода по осознаниям и фактам', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('просьба об осознаниях — insights каждой записи по датам с [#id]', async () => {
    await seed();
    const text = await block('перечисли все мои осознания за октябрь 2026');
    for (const n of DOCS) {
      expect(text, n.id).toContain(`[#${n.id} · 2026-10-${String(n.day).padStart(2, '0')}] ${n.insight}`);
      expect(text, `summary вместо insights у ${n.id}`).not.toContain(n.summary);
    }
    expect(text).not.toContain('СКРЫТОЕ_ОЗАРЕНИЕ');
    expect(text).not.toContain('КОРЗИННОЕ_ОЗАРЕНИЕ');
    expect(text).not.toContain('local_pr2_hidden');
    expect(text).not.toContain('local_pr2_trash');
  });

  it('«что случилось» — факты каждой записи', async () => {
    await seed();
    const text = await block('перечисли все, что случилось за октябрь 2026');
    for (const n of DOCS) {
      expect(text, n.id).toContain(`[#${n.id} · 2026-10-${String(n.day).padStart(2, '0')}] ${n.fact}`);
    }
    expect(text).not.toContain('СКРЫТЫЙ_ФАКТ');
    expect(text).not.toContain('КОРЗИННЫЙ_ФАКТ');
  });

  it('двадцать пять записей влезают без текстов; сверх потолка — «показаны N из M»', async () => {
    await seed();
    const db = await getLocalDb();
    for (let i = 1; i <= 22; i++) {
      const id = `local_pr2_extra_${String(i).padStart(2, '0')}`;
      const at = OCT_1 + (i % 20) * DAY;
      await db.put('documents', {
        id, guestId: 'u1', title: `Доп ${i}`, currentVersion: 1,
        firstSessionAt: at, lastSessionAt: at, tags: [],
      } as never);
      await db.put('aiSummaries', {
        documentId: id, processedAt: OCT_1, summary: `СУТЬ_ДОП_${i}`, themes: [],
        insights: [`ОЗАРЕНИЕ_ДОП_${i}`], extractedFacts: [`ФАКТ_ДОП_${i}`],
      } as never);
    }
    const text = await block('перечисли все мои осознания за октябрь 2026');
    for (let i = 1; i <= 22; i++) {
      expect(text, `доп ${i}`).toContain(`ОЗАРЕНИЕ_ДОП_${i}`);
    }
    expect(text).toMatch(/Показаны 25 из 25|Все записи периода/);
  });
});
