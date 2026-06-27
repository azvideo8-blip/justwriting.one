import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
});

beforeEach(async () => {
  await db.doc(`aiGlobalDaily/${DATE}`).delete().catch(() => {});
  await db.doc(`aiDailyLimit/test-uid`).delete().catch(() => {});
});

// These tests replicate the exact logic from aiUtils.ts tryReserveGlobalRequest
// and checkDailyLimit against the real Firestore emulator.

const TIER_LIMITS = {
  requestsPerDay: 5, // low limit for testing
  tokensPerDay: 25_000_000,
};

async function tryReserveGlobalRequest(): Promise<boolean> {
  const ref = db.doc(`aiGlobalDaily/${DATE}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    const requests = d?.requests ?? 0;
    const tokens = (d?.promptTokens ?? 0) + (d?.completionTokens ?? 0);
    if (requests >= TIER_LIMITS.requestsPerDay || tokens >= TIER_LIMITS.tokensPerDay) return false;
    tx.set(ref, { requests: FieldValue.increment(1), date: DATE, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}

async function refundGlobalRequest(): Promise<void> {
  const ref = db.doc(`aiGlobalDaily/${DATE}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || data.date !== DATE) return;
    tx.update(ref, { requests: Math.max(0, (data.requests ?? 1) - 1) });
  }).catch(() => {});
}

const DAILY_LIMIT = 3;

async function checkDailyLimit(uid: string): Promise<boolean> {
  const ref = db.doc(`aiDailyLimit/${uid}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || data.date !== DATE) {
      tx.set(ref, { count: 1, date: DATE });
      return true;
    }
    if (data.count >= DAILY_LIMIT) return false;
    tx.update(ref, { count: data.count + 1 });
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
    // Fire N parallel requests at the boundary — all should not pass
    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, () => tryReserveGlobalRequest())
    );
    const allowed = results.filter(r => r).length;
    // With the transaction-based approach, exactly TIER_LIMITS.requestsPerDay should pass
    expect(allowed).toBe(TIER_LIMITS.requestsPerDay);
    expect(allowed).toBeLessThanOrEqual(TIER_LIMITS.requestsPerDay);

    // Verify the actual counter in the DB
    const snap = await db.doc(`aiGlobalDaily/${DATE}`).get();
    expect(snap.data()?.requests).toBe(TIER_LIMITS.requestsPerDay);
  });
});

describe('refundGlobalRequest — global limit refund on AI failure', () => {
  it('decrements the global counter by 1', async () => {
    await tryReserveGlobalRequest();
    await tryReserveGlobalRequest();
    let snap = await db.doc(`aiGlobalDaily/${DATE}`).get();
    expect(snap.data()?.requests).toBe(2);

    await refundGlobalRequest();
    snap = await db.doc(`aiGlobalDaily/${DATE}`).get();
    expect(snap.data()?.requests).toBe(1);
  });

  it('does not go below zero', async () => {
    await refundGlobalRequest(); // no prior reservation
    const snap = await db.doc(`aiGlobalDaily/${DATE}`).get();
    expect((snap.data()?.requests ?? 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('checkDailyLimit — per-user daily limit', () => {
  it('allows requests up to the per-user limit', async () => {
    for (let i = 0; i < DAILY_LIMIT; i++) {
      expect(await checkDailyLimit('test-uid')).toBe(true);
    }
  });

  it('denies the (N+1)th request', async () => {
    for (let i = 0; i < DAILY_LIMIT; i++) {
      await checkDailyLimit('test-uid');
    }
    expect(await checkDailyLimit('test-uid')).toBe(false);
  });

  it('refund restores one slot', async () => {
    for (let i = 0; i < DAILY_LIMIT; i++) {
      await checkDailyLimit('test-uid');
    }
    expect(await checkDailyLimit('test-uid')).toBe(false);

    await refundDailyLimit('test-uid');
    expect(await checkDailyLimit('test-uid')).toBe(true);
  });

  it('does not exceed the limit under concurrent requests', async () => {
    const N = 10;
    const results = await Promise.all(
      Array.from({ length: N }, () => checkDailyLimit('test-uid'))
    );
    const allowed = results.filter(r => r).length;
    expect(allowed).toBe(DAILY_LIMIT);

    const snap = await db.doc(`aiDailyLimit/test-uid`).get();
    expect(snap.data()?.count).toBe(DAILY_LIMIT);
  });
});

describe('refundDailyLimit — per-user refund on AI failure', () => {
  it('decrements the per-user counter by 1', async () => {
    await checkDailyLimit('test-uid');
    await checkDailyLimit('test-uid');
    let snap = await db.doc(`aiDailyLimit/test-uid`).get();
    expect(snap.data()?.count).toBe(2);

    await refundDailyLimit('test-uid');
    snap = await db.doc(`aiDailyLimit/test-uid`).get();
    expect(snap.data()?.count).toBe(1);
  });

  it('does not go below zero', async () => {
    await refundDailyLimit('test-uid'); // no prior usage
    const snap = await db.doc(`aiDailyLimit/test-uid`).get();
    // Should be 0 or absent
    expect((snap.data()?.count ?? 0)).toBeGreaterThanOrEqual(0);
  });
});
