// TEST-1: regression tests for items 1.5 (atomic token reserve + refund
// releases it) and 2.19 (refund targets the charged day).
//
// Ticket trap honoured: pool.query is mocked, but assertions are made on the
// SQL TEXT that reached it — not on the fact of a call.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type CapturedQuery = { text: string; params: unknown[] };

const poolQueries: CapturedQuery[] = [];
const clientQueries: CapturedQuery[] = [];

let poolResult: { rows: unknown[] } = { rows: [{ tokens_reserved: 8192 }] };
let clientResults: Array<{ rows: unknown[] }> = [];

vi.mock('pg', () => {
  class FakePool {
    query = vi.fn(async (text: string, params?: unknown[]) => {
      poolQueries.push({ text, params: params ?? [] });
      return poolResult;
    });
    connect = vi.fn(async () => ({
      query: vi.fn(async (text: string, params?: unknown[]) => {
        clientQueries.push({ text, params: params ?? [] });
        const r = clientResults.shift() ?? { rows: [] };
        return r;
      }),
      release: vi.fn(),
    }));
  }
  return { Pool: FakePool };
});

import { postgresAiContext } from '../postgresAiContext';

const TODAY = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  poolQueries.length = 0;
  clientQueries.length = 0;
  poolResult = { rows: [{ tokens_reserved: 8192 }] };
  clientResults = [];
});

describe('1.5 atomic global token reserve', () => {
  it('reserves call_count AND tokens in ONE statement', async () => {
    await postgresAiContext.tryReserveGlobalRequest(1000);

    expect(poolQueries).toHaveLength(1);
    const sql = poolQueries[0]!.text;
    // Reserve touches the token column inside the same INSERT..ON CONFLICT:
    expect(sql).toMatch(/INSERT INTO ai_global_daily \(date, call_count, tokens\)/);
    expect(sql).toMatch(/tokens\s*=\s*coalesce\(ai_global_daily\.tokens, 0\) \+ \$3::int/);
    // The WHERE guards on both ceilings:
    expect(sql).toMatch(/call_count < \$2::int/);
    expect(sql).toMatch(/coalesce\(ai_global_daily\.tokens, 0\) \+ \$3::int <= \$4::bigint/);
    expect(poolQueries[0]!.params).toEqual([TODAY, expect.any(Number), 1000, expect.any(Number)]);
  });

  it('returns null when the combined guard rejects the row', async () => {
    poolResult = { rows: [] };
    const res = await postgresAiContext.tryReserveGlobalRequest(999999);
    expect(res).toBeNull();
  });

  it('refundGlobalRequest releases the reserved allowance together with the call count', async () => {
    await postgresAiContext.refundGlobalRequest({ date: '2026-08-20', shardId: '0', allowance: 1234 });

    const sql = poolQueries[0]!.text;
    expect(sql).toMatch(/call_count = GREATEST\(0, call_count - 1\)/);
    expect(sql).toMatch(/tokens\s*=\s*GREATEST\(0,\s*coalesce\(tokens, 0\) - \$2::int\)/);
    expect(poolQueries[0]!.params).toEqual(['2026-08-20', 1234]);
  });

  it('recordUsage reconciles the reservation instead of adding on top of it', async () => {
    clientResults = [
      { rows: [] },   // ai_usage upsert
    ];
    poolQueries.length = 0;
    await postgresAiContext.recordUsage(
      'u1', 15, 7,
      { model: 'm', fn: 'test' },
      { date: '2026-08-20', shardId: '0', allowance: 8192 },
    );

    // The reconcile UPDATE runs inside the transaction (clientQueries), and its
    // shape is subtract-allowance-add-actual — not a bare add.
    const reconcile = clientQueries.find(q => /ai_global_daily/.test(q.text));
    expect(reconcile).toBeDefined();
    expect(reconcile!.text).toMatch(/GREATEST\(0, coalesce\(tokens, 0\) - \$3::int \+ \$1::int\)/);
    expect(reconcile!.params).toEqual([22, '2026-08-20', 8192]);
  });
});

describe('2.19 refunds target the charged day', () => {
  it('refundDailyLimit uses chargedDay, not today()', async () => {
    await postgresAiContext.refundDailyLimit('u1', '2026-08-01');
    expect(poolQueries[0]!.params).toEqual(['u1', '2026-08-01']);
    expect(poolQueries[0]!.text).toMatch(/kind = 'chat'/);
  });

  it('refundBulkLimit uses chargedDay, not today()', async () => {
    await postgresAiContext.refundBulkLimit('u1', '2026-07-30');
    expect(poolQueries[0]!.params).toEqual(['u1', '2026-07-30']);
    expect(poolQueries[0]!.text).toMatch(/kind = 'bulk'/);
  });

  it('checkAndIncrementLimit returns the day it charged', async () => {
    clientResults = [
      { rows: [{ uid: 'u1' }] },          // cooldown claim
      { rows: [{ call_count: 1 }] },      // daily limit insert
    ];
    const verdict = await postgresAiContext.checkAndIncrementLimit('u1');
    if (verdict === 'DAILY_LIMIT' || verdict === 'RATE_LIMIT') throw new Error('expected success');
    expect(verdict.ok).toBe(true);
    expect(verdict.day).toBe(TODAY);
  });

  it('checkAndIncrementBulkLimit returns a verdict object with day', async () => {
    clientResults = [{ rows: [{ call_count: 1 }] }];
    const verdict = await postgresAiContext.checkAndIncrementBulkLimit('u1');
    if (verdict === 'RATE_LIMIT') throw new Error('expected success');
    expect(verdict.ok).toBe(true);
    expect(verdict.day).toBe(TODAY);
  });
});

// AUD-18: у bulk-эндпоинтов есть суточный потолок, но нет лимита во времени —
// весь день можно вычерпать за минуту. Окно скользящее и ключуется
// (uid, endpoint), с бюджетом вызовов внутри окна: жёсткие «один вызов в
// интервал» ломают индексацию и второй поиск за минуту (см. комментарий в
// postgresAiContext). Фальсификация: снять проверку счётчика — второй тест
// перестаёт получать RATE_LIMIT.
describe('AUD-18 bulk interval limit', () => {
  it('moves a per-(uid, endpoint) sliding window before charging the daily limit', async () => {
    poolResult = { rows: [{ calls: 1 }] };
    clientResults = [{ rows: [{ call_count: 1 }] }];
    await postgresAiContext.checkAndIncrementBulkLimit('u1', 'rerank');

    expect(poolQueries[0]!.text).toMatch(/INSERT INTO ai_bulk_cooldown \(uid, endpoint, window_start, calls\)/);
    expect(poolQueries[0]!.text).toMatch(/ON CONFLICT \(uid, endpoint\)/);
    expect(poolQueries[0]!.text).toMatch(/window_start < now\(\) - \(\$2 \|\| ' milliseconds'\)::interval/);
    expect(poolQueries[0]!.text).toMatch(/THEN 1 ELSE ai_bulk_cooldown\.calls \+ 1 END/);
    expect(poolQueries[0]!.params).toEqual(['u1', expect.any(String), 'rerank']);
  });

  it('lets a burst through inside the window budget', async () => {
    // Двадцатый вызов в окне ещё проходит: индексация и поиск бурстят.
    poolResult = { rows: [{ calls: 20 }] };
    clientResults = [{ rows: [{ call_count: 3 }] }];
    const verdict = await postgresAiContext.checkAndIncrementBulkLimit('u1', 'embed');
    expect(verdict).not.toBe('RATE_LIMIT');
    expect(clientQueries.length).toBeGreaterThan(0);
  });

  it("returns 'RATE_LIMIT' and never touches the daily counter past the budget", async () => {
    poolResult = { rows: [{ calls: 21 }] };
    const verdict = await postgresAiContext.checkAndIncrementBulkLimit('u1', 'rerank');
    expect(verdict).toBe('RATE_LIMIT');
    expect(clientQueries).toHaveLength(0);
  });
});
