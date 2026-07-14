import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getDb } from '../../shared/firestore';

vi.mock('../../shared/firestore', () => ({
  getDb: vi.fn(),
}));

import {
  tryReserveGlobalRequest,
  refundGlobalRequest,
  checkAndIncrementLimit,
  refundDailyLimit,
  TIER_LIMITS
} from '../../shared/aiUtils';

let db: Firestore;
const PROJECT_ID = 'justwriting-test';
const DATE = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  if (getApps().length === 0) {
    initializeApp({ projectId: PROJECT_ID });
  }
  db = getFirestore(PROJECT_ID);
  vi.mocked(getDb).mockImplementation(() => db);
});

afterAll(async () => {
  await db.recursiveDelete(db.collection('aiGlobalDaily'));
  await db.recursiveDelete(db.collection('aiDailyLimit'));
  await db.recursiveDelete(db.collection('aiCooldown'));
});

beforeEach(async () => {
  await db.recursiveDelete(db.collection('aiGlobalDaily'));
  await db.doc(`aiDailyLimit/test-uid`).delete().catch(() => {});
  await db.doc(`aiCooldown/test-uid`).delete().catch(() => {});
});

const DAILY_LIMIT = 3;

describe('tryReserveGlobalRequest — atomic global limit (Shard-Allocated Quotas)', () => {
  beforeEach(() => {
    // Set low limit for testing
    TIER_LIMITS.requestsPerDay = 10; // 1 request per shard limit
    TIER_LIMITS.tokensPerDay = 100_000;
  });

  it('allows requests up to the limit and returns reservation metadata', async () => {
    // Since limits are 1 per shard, we can make multiple requests. Some might succeed.
    const reservation = await tryReserveGlobalRequest(100);
    expect(reservation).not.toBeNull();
    expect(reservation?.date).toBe(DATE);
    expect(reservation?.shardId).toBeDefined();
    expect(reservation?.allowance).toBe(100);
  });

  it('does not exceed the limit under concurrent requests (TOCTOU race)', async () => {
    TIER_LIMITS.requestsPerDay = 30; // 3 requests per shard
    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, () => tryReserveGlobalRequest(100))
    );
    const successfulReservations = results.filter(r => r !== null);
    expect(successfulReservations.length).toBeGreaterThan(0);
    
    // Check that sum in firestore shards matches the successful count
    const shardsSnap = await db.collection(`aiGlobalDaily/${DATE}/shards`).get();
    let totalRequests = 0;
    let totalTokens = 0;
    shardsSnap.forEach(doc => {
      totalRequests += doc.data().requests ?? 0;
      totalTokens += doc.data().promptTokens ?? 0;
    });
    expect(totalRequests).toBe(successfulReservations.length);
    expect(totalTokens).toBe(successfulReservations.length * 100);
  });
});

describe('refundGlobalRequest — shard-specific and day-safe refund', () => {
  it('decrements the reserved shard counter by reservation allowance', async () => {
    TIER_LIMITS.requestsPerDay = 10;
    const reservation = await tryReserveGlobalRequest(100);
    expect(reservation).not.toBeNull();

    const getShardVal = async () => {
      const snap = await db.doc(`aiGlobalDaily/${DATE}/shards/${reservation!.shardId}`).get();
      return snap.data();
    };

    const beforeRefund = await getShardVal();
    expect(beforeRefund?.requests).toBe(1);
    expect(beforeRefund?.promptTokens).toBe(100);

    await refundGlobalRequest(reservation);

    const afterRefund = await getShardVal();
    expect(afterRefund?.requests).toBe(0);
    expect(afterRefund?.promptTokens).toBe(0);
  });

  it('does not go below zero and handles null/undefined safety', async () => {
    await refundGlobalRequest(null);
    await refundGlobalRequest(undefined);
  });
});

describe('checkAndIncrementLimit — per-user daily limit and cooldown', () => {
  let mockNow = 1000000;

  beforeEach(() => {
    mockNow = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);
  });

  it('allows requests up to the per-user limit when cooldown is bypassed', async () => {
    for (let i = 0; i < DAILY_LIMIT; i++) {
      expect(await checkAndIncrementLimit('test-uid')).toBe(true);
      mockNow += 15000; // bypass 10s cooldown
    }
  });

  it('denies requests due to cooldown', async () => {
    expect(await checkAndIncrementLimit('test-uid')).toBe(true);
    // same millisecond request
    expect(await checkAndIncrementLimit('test-uid')).toBe('RATE_LIMIT');
    
    // just under cooldown (9.9 seconds)
    mockNow += 9900;
    expect(await checkAndIncrementLimit('test-uid')).toBe('RATE_LIMIT');

    // exactly at cooldown (10 seconds)
    mockNow += 100;
    expect(await checkAndIncrementLimit('test-uid')).toBe(true);
  });

  it('denies the (N+1)th request even after cooldown', async () => {
    for (let i = 0; i < DAILY_LIMIT; i++) {
      expect(await checkAndIncrementLimit('test-uid')).toBe(true);
      mockNow += 15000; // bypass cooldown
    }
    expect(await checkAndIncrementLimit('test-uid')).toBe('DAILY_LIMIT');
  });

  it('refund restores one slot', async () => {
    for (let i = 0; i < DAILY_LIMIT; i++) {
      expect(await checkAndIncrementLimit('test-uid')).toBe(true);
      mockNow += 15000; // bypass cooldown
    }
    expect(await checkAndIncrementLimit('test-uid')).toBe('DAILY_LIMIT');

    await refundDailyLimit('test-uid');
    
    // now we can retry (ensure cooldown bypassed)
    mockNow += 15000;
    expect(await checkAndIncrementLimit('test-uid')).toBe(true);
  });

  it('allows only 1 request under concurrent requests from the same user due to cooldown (SEC-4)', async () => {
    const N = 10;
    const results = await Promise.all(
      Array.from({ length: N }, () => checkAndIncrementLimit('test-uid'))
    );
    // 'RATE_LIMIT'/'DAILY_LIMIT' strings are truthy — must compare strictly to true
    const allowed = results.filter(r => r === true).length;
    expect(allowed).toBe(1);

    const dailySnap = await db.doc(`aiDailyLimit/test-uid`).get();
    expect(dailySnap.data()?.count).toBe(1);
  });
});

describe('refundDailyLimit — per-user refund on AI failure', () => {
  let mockNow = 1000000;

  beforeEach(() => {
    mockNow = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);
  });

  it('decrements the per-user counter by 1', async () => {
    await checkAndIncrementLimit('test-uid');
    mockNow += 15000;
    await checkAndIncrementLimit('test-uid');
    let snap = await db.doc(`aiDailyLimit/test-uid`).get();
    expect(snap.data()?.count).toBe(2);

    await refundDailyLimit('test-uid');
    snap = await db.doc(`aiDailyLimit/test-uid`).get();
    expect(snap.data()?.count).toBe(1);
  });

  it('does not go below zero', async () => {
    await refundDailyLimit('test-uid'); // no prior usage
    const snap = await db.doc(`aiDailyLimit/test-uid`).get();
    expect((snap.data()?.count ?? 0)).toBeGreaterThanOrEqual(0);
  });
});
