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
let poolShouldThrow: Error | null = null;
let poolConnectShouldThrow: Error | null = null;
let clientQueryShouldThrow: Error | null = null;
let clientResults: Array<{ rows: unknown[] }> = [];
let clientRole: string | null = 'user';

vi.mock('pg', () => {
  class FakePool {
    on = vi.fn().mockReturnThis();
    query = vi.fn(async (text: string, params?: unknown[]) => {
      poolQueries.push({ text, params: params ?? [] });
      if (poolShouldThrow) throw poolShouldThrow;
      return poolResult;
    });
    connect = vi.fn(async () => {
      if (poolConnectShouldThrow) throw poolConnectShouldThrow;
      return {
        on: vi.fn().mockReturnThis(),
        removeListener: vi.fn().mockReturnThis(),
        query: vi.fn(async (text: string, params?: unknown[]) => {
          clientQueries.push({ text, params: params ?? [] });
          if (clientQueryShouldThrow) throw clientQueryShouldThrow;
          // R10-8: роль читается на том же соединении, но слот clientResults не
          // тратит — иначе фикстуры со счётчиками разъезжаются на один запрос.
          if (/SELECT\s+ROLE/i.test(text)) return { rows: [{ role: clientRole }] };
          const r = clientResults.shift() ?? { rows: [] };
          return r;
        }),
        release: vi.fn(),
      };
    });
  }
  return { Pool: FakePool };
});

import { postgresAiContext } from '../postgresAiContext';

const TODAY = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  poolQueries.length = 0;
  clientQueries.length = 0;
  poolResult = { rows: [{ tokens_reserved: 8192 }] };
  poolShouldThrow = null;
  poolConnectShouldThrow = null;
  clientQueryShouldThrow = null;
  clientResults = [];
  clientRole = 'user';
});

describe('1.5 atomic global token reserve', () => {
  it('reserves call_count AND tokens in ONE statement', async () => {
    await postgresAiContext.tryReserveGlobalRequest(1000);

    expect(poolQueries).toHaveLength(1);
    const sql = poolQueries[0]!.text;
    // Reserve touches the token column inside the same INSERT..ON CONFLICT:
    expect(sql).toMatch(/INSERT INTO (public\.)?ai_global_daily \(date, call_count, tokens\)/);
    expect(sql).toMatch(/tokens\s*=\s*coalesce\((public\.)?ai_global_daily\.tokens, 0\) \+ \$3::int/);
    // The WHERE guards on both ceilings:
    expect(sql).toMatch(/call_count < \$2::int/);
    expect(sql).toMatch(/coalesce\((public\.)?ai_global_daily\.tokens, 0\) \+ \$3::int <= \$4::bigint/);
    expect(poolQueries[0]!.params).toEqual([TODAY, expect.any(Number), 1000, expect.any(Number)]);
  });

  it('returns null when the combined guard rejects the row', async () => {
    poolResult = { rows: [] };
    const res = await postgresAiContext.tryReserveGlobalRequest(999999);
    expect(res).toBeNull();
  });

  it('returns { error: "unavailable" } when pool.query throws', async () => {
    poolShouldThrow = new Error('connection terminated');
    const res = await postgresAiContext.tryReserveGlobalRequest(1000);
    expect(res).toEqual({ error: 'unavailable' });
  });

  it('getAiConsent returns { granted: false, error: "unavailable" } on pool error', async () => {
    poolShouldThrow = new Error('pg down');
    const res = await postgresAiContext.getAiConsent('u1');
    expect(res).toEqual({ granted: false, error: 'unavailable' });
  });

  it('getIndexingConsent returns { granted: false, error: "unavailable" } on pool error', async () => {
    poolShouldThrow = new Error('pg down');
    const res = await postgresAiContext.getIndexingConsent('u1');
    expect(res).toEqual({ granted: false, error: 'unavailable' });
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

  it('recordUsage logs the per-call fn/model breakdown into ai_usage_calls', async () => {
    clientResults = [
      { rows: [] }, // ai_usage upsert
      { rows: [] }, // ai_usage_calls insert
    ];
    poolQueries.length = 0;
    await postgresAiContext.recordUsage(
      'u1', 15, 7,
      { model: 'deepseek/deepseek-v4-flash', fn: 'chat' },
      null,
    );

    const perCall = clientQueries.find(q => /ai_usage_calls/.test(q.text));
    expect(perCall).toBeDefined();
    expect(perCall!.text).toMatch(/INSERT INTO (public\.)?ai_usage_calls/);
    expect(perCall!.params).toEqual(['u1', 'chat', 'deepseek/deepseek-v4-flash', 15, 7]);
  });

  it('recordUsage falls back to fn "unknown" when opts is omitted', async () => {
    clientResults = [{ rows: [] }, { rows: [] }];
    await postgresAiContext.recordUsage('u1', 5, 3);

    const perCall = clientQueries.find(q => /ai_usage_calls/.test(q.text));
    expect(perCall!.params).toEqual(['u1', 'unknown', null, 5, 3]);
  });
});

describe('2.19 refunds target the charged day', () => {
  it('refundDailyLimit uses chargedDay, not today()', async () => {
    await postgresAiContext.refundDailyLimit('u1', '2026-08-01');
    expect(poolQueries[0]!.params).toEqual(['u1', '2026-08-01', 'chat']);
    expect(poolQueries[0]!.text).toMatch(/kind = \$3/);
  });

  it('refundDailyLimit decrements reasoning kind when passed', async () => {
    await postgresAiContext.refundDailyLimit('u1', '2026-08-01', 'reasoning');
    expect(poolQueries[0]!.params).toEqual(['u1', '2026-08-01', 'reasoning']);
    expect(poolQueries[0]!.text).toMatch(/kind = \$3/);
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
    if (typeof verdict !== 'object' || verdict === null || !('ok' in verdict)) throw new Error('expected success');
    expect(verdict.ok).toBe(true);
    expect(verdict.day).toBe(TODAY);
  });

  it('checkAndIncrementBulkLimit returns a verdict object with day', async () => {
    clientResults = [{ rows: [{ call_count: 1 }] }];
    const verdict = await postgresAiContext.checkAndIncrementBulkLimit('u1');
    if (typeof verdict !== 'object' || verdict === null || !('ok' in verdict)) throw new Error('expected success');
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

    expect(poolQueries[0]!.text).toMatch(/INSERT INTO (public\.)?ai_bulk_cooldown \(uid, endpoint, window_start, calls\)/);
    expect(poolQueries[0]!.text).toMatch(/ON CONFLICT \(uid, endpoint\)/);
    expect(poolQueries[0]!.text).toMatch(/window_start < now\(\) - \(\$2 \|\| ' milliseconds'\)::interval/);
    expect(poolQueries[0]!.text).toMatch(/THEN 1 ELSE (public\.)?ai_bulk_cooldown\.calls \+ 1 END/);
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

  it('falls through to the daily cap when the window table is missing', async () => {
    // Миграция накатывается отдельно от выкатки службы: пока таблицы нет,
    // ограничитель частоты выключен, но суточный потолок обязан работать.
    poolShouldThrow = new Error('relation "ai_bulk_cooldown" does not exist');
    clientResults = [{ rows: [{ call_count: 7 }] }];
    const verdict = await postgresAiContext.checkAndIncrementBulkLimit('u1', 'embed');
    expect(verdict).toEqual({ ok: true, day: TODAY });
    expect(clientQueries.some(q => /ai_daily_limit/.test(q.text))).toBe(true);
  });

  it("returns 'RATE_LIMIT' and never touches the daily counter past the budget", async () => {
    poolResult = { rows: [{ calls: 21 }] };
    const verdict = await postgresAiContext.checkAndIncrementBulkLimit('u1', 'rerank');
    expect(verdict).toBe('RATE_LIMIT');
    expect(clientQueries).toHaveLength(0);
  });
});

describe('S-15: limit check distinguishes unavailable/unauthorized from exhausted limit', () => {
  it('checkDailyLimit returns reason: unavailable when pool.connect rejects', async () => {
    poolConnectShouldThrow = new Error('connection refused');
    const verdict = await postgresAiContext.checkDailyLimit('u1');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('unavailable');
  });

  it('checkDailyLimit returns reason: unauthorized on FK violation 23503', async () => {
    const fkErr: any = new Error('foreign key violation');
    fkErr.code = '23503';
    clientQueryShouldThrow = fkErr;
    const verdict = await postgresAiContext.checkDailyLimit('u1');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('unauthorized');
  });

  // N-77: весь запрос транзакции — на одном соединении. Вложенный pool.query за
  // ролью при полном пуле waiting навсегда, поэтому здесь прямо: роль — в
  // clientQueries, и ни одного запроса к пулу, пока открыт BEGIN.
  it('роль админа читается тем же соединением, что держит транзакцию', async () => {
    clientResults = [{ rows: [{ call_count: 1 }] }];
    clientRole = 'admin';
    const verdict = await postgresAiContext.checkDailyLimit('u1');

    expect(verdict.ok).toBe(true);
    expect(clientQueries.some(q => /SELECT\s+ROLE/i.test(q.text))).toBe(true);
    expect(poolQueries).toHaveLength(0);
  });

  it('checkAndIncrementBulkLimit returns reason: unavailable when pool.connect rejects', async () => {
    poolConnectShouldThrow = new Error('connection refused');
    const verdict = await postgresAiContext.checkAndIncrementBulkLimit('u1');
    expect(typeof verdict === 'object' && verdict.ok === false).toBe(true);
    if (typeof verdict === 'object') {
      expect(verdict.reason).toBe('unavailable');
    }
  });

  it('checkAndIncrementLimit returns UNAVAILABLE when pool.connect rejects', async () => {
    poolResult = { rows: [{ uid: 'u1' }] };
    poolConnectShouldThrow = new Error('connection refused');
    const verdict = await postgresAiContext.checkAndIncrementLimit('u1');
    expect(verdict).toBe('UNAVAILABLE');
  });

  it('checkAndIncrementLimit returns UNAUTHORIZED on FK violation 23503', async () => {
    poolResult = { rows: [{ uid: 'u1' }] };
    const fkErr: any = new Error('foreign key violation');
    fkErr.code = '23503';
    clientQueryShouldThrow = fkErr;
    const verdict = await postgresAiContext.checkAndIncrementLimit('u1');
    expect(verdict).toBe('UNAUTHORIZED');
  });
});

describe('ST-4: separate reasoning quota', () => {
  it('five chat calls then one reasoning call is allowed; 6th reasoning refused; chat still allowed', async () => {
    // 1. One reasoning call with call_count = 1 (after 5 chats) -> allowed
    clientResults = [
      { rows: [] }, // BEGIN
      { rows: [{ call_count: 1 }] }, // reasoning insert
    ];
    const r1 = await postgresAiContext.checkDailyLimit('u1', true);
    expect(r1.ok).toBe(true);
    expect(clientQueries.some(q => q.text.includes("kind, call_count)") && q.params.includes('reasoning'))).toBe(true);

    // 2. Sixth reasoning call with call_count = 6 -> limit_exceeded
    clientQueries.length = 0;
    clientResults = [
      { rows: [] },
      { rows: [{ call_count: 6 }] },
    ];
    const r6 = await postgresAiContext.checkDailyLimit('u1', true);
    expect(r6.ok).toBe(false);
    expect(r6.reason).toBe('limit_exceeded');

    // 3. Next chat call with call_count = 6 -> allowed (chat limit is 30)
    clientQueries.length = 0;
    clientResults = [
      { rows: [] },
      { rows: [{ call_count: 6 }] },
    ];
    const chatNext = await postgresAiContext.checkDailyLimit('u1', false);
    expect(chatNext.ok).toBe(true);
    expect(clientQueries.some(q => q.text.includes("kind, call_count)") && q.params.includes('chat'))).toBe(true);
  });

  it('checkAndIncrementLimit returns REASONING_LIMIT when reasoning is exhausted', async () => {
    poolResult = { rows: [{ uid: 'u1' }] }; // cooldown OK
    clientResults = [
      { rows: [] }, // BEGIN
      { rows: [{ call_count: 6 }] }, // reasoning limit exceeded
    ];
    const res = await postgresAiContext.checkAndIncrementLimit('u1', true);
    expect(res).toBe('REASONING_LIMIT');
  });

  it('getDailyLimitCount returns both chat and reasoning counts', async () => {
    poolResult = {
      rows: [
        { kind: 'chat', call_count: 5 },
        { kind: 'reasoning', call_count: 2 },
      ],
    };
    const counts = await postgresAiContext.getDailyLimitCount('u1');
    expect(counts.used).toBe(5);
    expect(counts.reasoningUsed).toBe(2);
    expect(counts.date).toBe(TODAY);
  });
});


