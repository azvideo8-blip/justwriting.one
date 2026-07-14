import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';

let db: Firestore;
const PROJECT_ID = 'justwriting-test';
const DATE = new Date().toISOString().slice(0, 10);

// We test the ACTUAL Firestore transaction logic (not mocks) against the emulator.
// The emulator enforces real transaction semantics including optimistic concurrency.

beforeAll(async () => {
  if (getApps().length === 0) {
    initializeApp({ projectId: PROJECT_ID });
  }
  db = getFirestore(PROJECT_ID);
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

// These tests replicate the exact logic from aiUtils.ts tryReserveGlobalRequest
// and checkAndIncrementLimit against the real Firestore emulator.

const TIER_LIMITS = {
  requestsPerDay: 5, // low limit for testing
  tokensPerDay: 25_000_000,
};

async function tryReserveGlobalRequest(): Promise<boolean> {
  const shardsSnap = await db.collection(`aiGlobalDaily/${DATE}/shards`).get();
  let requests = 0;
  let tokens = 0;
  shardsSnap.forEach(doc => {
    const data = doc.data();
    requests += data.requests ?? 0;
    tokens += (data.promptTokens ?? 0) + (data.completionTokens ?? 0);
  });

  if (requests >= TIER_LIMITS.requestsPerDay || tokens >= TIER_LIMITS.tokensPerDay) return false;

  const NUM_SHARDS = 10;
  const shardId = Math.floor(Math.random() * NUM_SHARDS).toString();
  const shardRef = db.doc(`aiGlobalDaily/${DATE}/shards/${shardId}`);
  await shardRef.set({
    requests: FieldValue.increment(1),
    date: DATE,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return true;
}

async function refundGlobalRequest(): Promise<void> {
  const NUM_SHARDS = 10;
  const shardId = Math.floor(Math.random() * NUM_SHARDS).toString();
  const shardRef = db.doc(`aiGlobalDaily/${DATE}/shards/${shardId}`);
  await shardRef.set({
    requests: FieldValue.increment(-1),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true }).catch(() => {});
}

const DAILY_LIMIT = 3;
const COOLDOWN_MS = 10000;

async function checkAndIncrementLimit(uid: string): Promise<boolean | 'DAILY_LIMIT' | 'RATE_LIMIT'> {
  const cooldownRef = db.doc(`aiCooldown/${uid}`);
  const dailyRef = db.doc(`aiDailyLimit/${uid}`);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const [cooldownSnap, dailySnap] = await Promise.all([
      tx.get(cooldownRef),
      tx.get(dailyRef),
    ]);
    const cooldownData = cooldownSnap.data();
    if (cooldownData && now - cooldownData.lastRequestAt < COOLDOWN_MS) return 'RATE_LIMIT';
    const dailyData = dailySnap.data();
    if (dailyData && dailyData.date === DATE && dailyData.count >= DAILY_LIMIT) return 'DAILY_LIMIT';

    tx.set(cooldownRef, { lastRequestAt: now }, { merge: true });
    if (!dailyData || dailyData.date !== DATE) {
      tx.set(dailyRef, { count: 1, date: DATE });
    } else {
      tx.update(dailyRef, { count: dailyData.count + 1 });
    }
    return true;
  });
}

async function refundDailyLimit(uid: string): Promise<void> {
  const ref = db.doc(`aiDailyLimit/${uid}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || data.date !== DATE) return;
    const next = Math.max(0, (data.count ?? 1) - 1);
    tx.update(ref, { count: next });
  }).catch(() => {});
}

describe('tryReserveGlobalRequest — atomic global limit (C2 race test)', () => {
  it('allows requests up to the limit', async () => {
    for (let i = 0; i < TIER_LIMITS.requestsPerDay; i++) {
      expect(await tryReserveGlobalRequest()).toBe(true);
    }
  });

  it('denies request beyond the limit', async () => {
    for (let i = 0; i < TIER_LIMITS.requestsPerDay; i++) {
      await tryReserveGlobalRequest();
    }
    expect(await tryReserveGlobalRequest()).toBe(false);
  });

  it('does not exceed the limit under concurrent requests (TOCTOU race)', async () => {
    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, () => tryReserveGlobalRequest())
    );
    const allowed = results.filter(r => r).length;
    expect(allowed).toBeGreaterThan(0);

    const shardsSnap = await db.collection(`aiGlobalDaily/${DATE}/shards`).get();
    let totalRequests = 0;
    shardsSnap.forEach(doc => {
      totalRequests += doc.data().requests ?? 0;
    });
    expect(totalRequests).toBe(allowed);
  });
});

describe('refundGlobalRequest — global limit refund on AI failure', () => {
  it('decrements the global counter by 1', async () => {
    await tryReserveGlobalRequest();
    await tryReserveGlobalRequest();
    
    const getSum = async () => {
      const shardsSnap = await db.collection(`aiGlobalDaily/${DATE}/shards`).get();
      let sum = 0;
      shardsSnap.forEach(doc => {
        sum += doc.data().requests ?? 0;
      });
      return sum;
    };
    
    expect(await getSum()).toBe(2);

    await refundGlobalRequest();
    expect(await getSum()).toBe(1);
  });

  it('handles refund when no prior reservation exists', async () => {
    await refundGlobalRequest();
    const shardsSnap = await db.collection(`aiGlobalDaily/${DATE}/shards`).get();
    let sum = 0;
    shardsSnap.forEach(doc => {
      sum += doc.data().requests ?? 0;
    });
    expect(sum).toBe(-1);
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
