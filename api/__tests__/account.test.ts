import { describe, it, expect, vi, beforeEach } from 'vitest';

// Удаление аккаунта — обязанность, а не удобство: закон требует, чтобы данных
// не осталось. Проверяем не «вызвался ли delete», а то, что задет тот стор,
// который каскад не забирает.
const query = vi.fn().mockResolvedValue({ rows: [] });
const poolQuery = vi.fn().mockResolvedValue({ rows: [{ uid: 'uid_1' }] });
const release = vi.fn();

const clientOn = vi.fn();
const clientRemoveListener = vi.fn();
const poolOn = vi.fn();

vi.mock('pg', () => ({
  Pool: class {
    on(...args: unknown[]) {
      return poolOn(...args);
    }
    query(...args: unknown[]) {
      return poolQuery(...args);
    }
    connect() {
      return Promise.resolve({
        query,
        release,
        on: clientOn,
        removeListener: clientRemoveListener,
      });
    }
  },
}));

const { deleteAccountLogic, sendTelemetryLogic, telemetryRowId } = await import('../account');

describe('deleteAccountLogic', () => {
  beforeEach(() => {
    query.mockClear();
    release.mockClear();
  });

  it('wipes local_store_records, which has no cascade to public.users', async () => {
    await deleteAccountLogic(null, 'uid_1');

    const statements = query.mock.calls.map(c => String(c[0]));
    expect(statements).toEqual([
      'begin',
      'delete from public.local_store_records where user_id = $1',
      'delete from public.users where uid = $1',
      'delete from auth.users where id = $1',
      'commit',
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual(['uid_1']);
    expect(release).toHaveBeenCalled();
  });

  it('N-5: deletes the account\'s telemetry row too', async () => {
    const orig = process.env.TELEMETRY_ID_PEPPER;
    process.env.TELEMETRY_ID_PEPPER = 'pepper-n5';
    try {
      await deleteAccountLogic(null, 'uid_n5');
      const del = query.mock.calls.find(c => String(c[0]).startsWith('delete from public.anonymized_telemetry'));
      expect(del?.[1]).toEqual([telemetryRowId('uid_n5')]);
    } finally {
      if (orig !== undefined) process.env.TELEMETRY_ID_PEPPER = orig; else delete process.env.TELEMETRY_ID_PEPPER;
    }
  });

  it('rolls back and reports failure instead of leaving a half-deleted account', async () => {
    query.mockImplementation((sql: string) =>
      sql.startsWith('delete from auth.users')
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ rows: [] }),
    );

    // Другой uid: cooldown удаления (AUDIT-H6) одноразовый на аккаунт,
    // первый тест уже израсходовал слот uid_1.
    await expect(deleteAccountLogic(null, 'uid_rollback')).rejects.toThrow('Account deletion failed.');
    expect(query.mock.calls.map(c => String(c[0]))).toContain('rollback');
  });
});

describe('sendTelemetryLogic (JW-SEC-06 / AG-SEC-C)', () => {
  const origPepper = process.env.TELEMETRY_ID_PEPPER;

  beforeEach(() => {
    poolQuery.mockReset();
    process.env.TELEMETRY_ID_PEPPER = 'test-telemetry-pepper';
  });

  afterEach(() => {
    if (origPepper !== undefined) process.env.TELEMETRY_ID_PEPPER = origPepper;
    else delete process.env.TELEMETRY_ID_PEPPER;
  });

  it('derives stable unique row id from uid and pepper', () => {
    const id1 = telemetryRowId('user_1');
    const id1_again = telemetryRowId('user_1');
    const id2 = telemetryRowId('user_2');

    expect(id1).toBe(id1_again);
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('throws internal error if TELEMETRY_ID_PEPPER is missing', () => {
    delete process.env.TELEMETRY_ID_PEPPER;
    expect(() => telemetryRowId('user_1')).toThrow('Telemetry is not configured.');
  });

  it('uses server-derived row ID and parameterized interval', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ uid: 'uid_1' }] }); // cooldown query
    poolQuery.mockResolvedValueOnce({ rows: [] }); // insert into anonymized_telemetry

    const payload = {
      notesCountBucket: '1-10',
      averageWordCount: 150,
    };

    const res = await sendTelemetryLogic(null, 'uid_1', payload);
    expect(res).toEqual({ success: true });

    expect(poolQuery).toHaveBeenCalledTimes(2);
    const [cooldownSql, cooldownParams] = poolQuery.mock.calls[0] as [string, unknown[]];
    expect(cooldownSql).toContain('where telemetry_cooldown.last_sent_at < now() - $2::interval');
    expect(cooldownParams).toEqual(['uid_1', '24 hours']);

    const [insertSql, insertParams] = poolQuery.mock.calls[1] as [string, unknown[]];
    expect(insertSql).toContain('insert into anonymized_telemetry');
    const expectedRowId = telemetryRowId('uid_1');
    expect(insertParams?.[0]).toBe(expectedRowId);
    expect(JSON.parse(insertParams?.[1] as string)).toEqual(expect.objectContaining({
      notesCountBucket: '1-10',
      averageWordCount: 150,
    }));
  });

  it('throws resource-exhausted when rate limit is exceeded', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] }); // 0 rows returned = rate limited

    const payload = {
      notesCountBucket: '1-10',
    };

    await expect(sendTelemetryLogic(null, 'uid_1', payload)).rejects.toThrow('Telemetry rate limit exceeded.');
  });
});
