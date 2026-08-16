import { describe, it, expect, vi, beforeEach } from 'vitest';

// Удаление аккаунта — обязанность, а не удобство: закон требует, чтобы данных
// не осталось. Проверяем не «вызвался ли delete», а то, что задет тот стор,
// который каскад не забирает.
const query = vi.fn().mockResolvedValue({ rows: [] });
const poolQuery = vi.fn().mockResolvedValue({ rows: [{ uid: 'uid_1' }] });
const release = vi.fn();

vi.mock('pg', () => ({
  Pool: class {
    query(...args: unknown[]) {
      return poolQuery(...args);
    }
    connect() {
      return Promise.resolve({ query, release });
    }
  },
}));

const { deleteAccountLogic, sendTelemetryLogic } = await import('../account');

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

  it('rolls back and reports failure instead of leaving a half-deleted account', async () => {
    query.mockImplementation((sql: string) =>
      sql.startsWith('delete from auth.users')
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ rows: [] }),
    );

    await expect(deleteAccountLogic(null, 'uid_1')).rejects.toThrow('Account deletion failed.');
    expect(query.mock.calls.map(c => String(c[0]))).toContain('rollback');
  });
});

describe('sendTelemetryLogic (JW-SEC-06)', () => {
  beforeEach(() => {
    poolQuery.mockReset();
  });

  it('parameterizes interval in cooldown query with $2::interval', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ uid: 'uid_1' }] }); // cooldown query
    poolQuery.mockResolvedValueOnce({ rows: [] }); // insert into anonymized_telemetry

    const payload = {
      telemetryId: 'tel_123',
      notesCountBucket: '1-10',
    };

    const res = await sendTelemetryLogic(null, 'uid_1', payload);
    expect(res).toEqual({ success: true });

    expect(poolQuery).toHaveBeenCalledTimes(2);
    const [cooldownSql, cooldownParams] = poolQuery.mock.calls[0] as [string, unknown[]];
    expect(cooldownSql).toContain('where telemetry_cooldown.last_sent_at < now() - $2::interval');
    expect(cooldownParams).toEqual(['uid_1', '24 hours']);
  });

  it('throws resource-exhausted when rate limit is exceeded', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] }); // 0 rows returned = rate limited

    const payload = {
      telemetryId: 'tel_123',
    };

    await expect(sendTelemetryLogic(null, 'uid_1', payload)).rejects.toThrow('Telemetry rate limit exceeded.');
  });
});
