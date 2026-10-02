import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSupabase } from '../../../supabase/client';
import { countSummaries } from '../summaries';
import { countEmbeddings } from '../embeddings';
import { countLocalStoreRecords } from '../localStore';

/**
 * drift-1, задача 1: счётчики облака считают, а не выкачивают.
 *
 * `getUserSummaries(...).length` тянет все строки со всем содержимым ради
 * одного числа. Счётчик обязан уйти head-запросом (тела нет, число в
 * заголовке) и взять результат из `count`, а не из длины `data`.
 */

vi.mock('../../../supabase/client', () => ({ getSupabase: vi.fn() }));

interface Recorded { table: string; select: unknown[]; filters: unknown[][] }

/** Облако, которое на head-запрос отвечает числом и НЕ отдаёт строк. */
function fakeCloud(answer: { count: number | null; error?: unknown }): Recorded[] {
  const calls: Recorded[] = [];
  vi.mocked(getSupabase).mockReturnValue({
    from(table: string) {
      const rec: Recorded = { table, select: [], filters: [] };
      calls.push(rec);
      const q: Record<string, unknown> = {
        select: (...a: unknown[]) => { rec.select = a; return q; },
        // Путь «выкачать всё» ходит через range — строк он здесь не получит.
        range: () => Promise.resolve({ data: [], error: null }),
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
          Promise.resolve({ count: answer.count, data: null, error: answer.error ?? null }).then(ok, bad),
      };
      for (const f of ['eq', 'in', 'or', 'gt', 'order', 'limit']) {
        q[f] = (...a: unknown[]) => { rec.filters.push([f, ...a]); return q; };
      }
      return q;
    },
  } as never);
  return calls;
}

const CASES = [
  { name: 'countSummaries', table: 'ai_summaries', run: () => countSummaries('u1') },
  { name: 'countEmbeddings', table: 'ai_embeddings', run: () => countEmbeddings('u1') },
  { name: 'countLocalStoreRecords', table: 'local_store_records', run: () => countLocalStoreRecords('u1', ['aiDialogues']) },
];

describe('drift-1: cloud counters count without pulling rows', () => {
  beforeEach(() => vi.clearAllMocks());

  for (const c of CASES) {
    it(`${c.name} sends a head request and reads the number from count`, async () => {
      const calls = fakeCloud({ count: 166 });

      expect(await c.run()).toBe(166);

      expect(calls).toHaveLength(1);
      expect(calls[0]!.table).toBe(c.table);
      expect(calls[0]!.select[1]).toEqual({ count: 'exact', head: true });
      expect(calls[0]!.filters).toContainEqual(['eq', 'user_id', 'u1']);
    });

    it(`${c.name} throws on a failed read instead of answering 0`, async () => {
      fakeCloud({ count: null, error: { message: 'boom' } });
      await expect(c.run()).rejects.toBeTruthy();
    });

    // «Нет ответа» — не «ноль»: панель по нулю сказала бы «в облаке пусто».
    it(`${c.name} throws when the server gives no number`, async () => {
      fakeCloud({ count: null });
      await expect(c.run()).rejects.toThrow(/COUNT_UNAVAILABLE/);
    });
  }

  it('countLocalStoreRecords counts records, not pages, and only the given stores', async () => {
    const calls = fakeCloud({ count: 5 });

    await countLocalStoreRecords('u1', ['aiDialogues', 'aiBeliefs']);

    expect(calls[0]!.filters).toContainEqual(['in', 'store', ['aiDialogues', 'aiBeliefs']]);
    // Страницы `key#1…` длинной записи в счёт не идут: только нулевая или запись без страниц.
    expect(calls[0]!.filters).toContainEqual(['or', 'payload->>page.is.null,payload->>page.eq.0']);
  });
});
