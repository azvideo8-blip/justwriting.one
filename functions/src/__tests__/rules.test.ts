import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails, type TestEnvironment } from '@firebase/rules-unit-testing';

let testEnv: TestEnvironment;

const PROJECT_ID = 'justwriting-test';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('firestore.rules — user documents', () => {
  it('allows owner to create a document with correct userId', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertSucceeds(
      db.doc('users/user-a/documents/doc-1').set({
        userId: 'user-a',
        title: 'My note',
        currentVersion: 1,
        totalWords: 100,
        totalDuration: 60,
        sessionsCount: 1,
        firstSessionAt: new Date(),
        lastSessionAt: new Date(),
      })
    );
  });

  it('denies creating a document with a different userId', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(
      db.doc('users/user-a/documents/doc-1').set({
        userId: 'user-b',
        title: 'My note',
      })
    );
  });

  it('allows owner to read their own documents', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await db.doc('users/user-a/documents/doc-1').set({
      userId: 'user-a',
      title: 'My note',
      currentVersion: 1,
      totalWords: 100,
      totalDuration: 60,
      sessionsCount: 1,
      firstSessionAt: new Date(),
      lastSessionAt: new Date(),
    });
    await assertSucceeds(db.doc('users/user-a/documents/doc-1').get());
  });

  it('denies reading another user\'s documents', async () => {
    const dbOwner = testEnv.authenticatedContext('user-a').firestore();
    const dbIntruder = testEnv.authenticatedContext('user-b').firestore();
    await dbOwner.doc('users/user-a/documents/doc-1').set({
      userId: 'user-a',
      title: 'My note',
      currentVersion: 1,
      totalWords: 100,
      totalDuration: 60,
      sessionsCount: 1,
      firstSessionAt: new Date(),
      lastSessionAt: new Date(),
    });
    await assertFails(dbIntruder.doc('users/user-a/documents/doc-1').get());
  });

  it('denies unauthenticated access to documents', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(db.doc('users/user-a/documents/doc-1').get());
  });

  it('prevents client from setting role field on user creation', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(
      db.doc('users/user-a').set({
        uid: 'user-a',
        email: 'a@test.com',
        role: 'admin',
      })
    );
  });

  it('allows client to create user without role field', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertSucceeds(
      db.doc('users/user-a').set({
        uid: 'user-a',
        email: 'a@test.com',
      })
    );
  });

  it('prevents client from updating role field', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await db.doc('users/user-a').set({
      uid: 'user-a',
      email: 'a@test.com',
    });
    await assertFails(
      db.doc('users/user-a').update({ role: 'admin' })
    );
  });
});

describe('firestore.rules — drafts', () => {
  it('allows owner to read and write their own draft', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertSucceeds(
      db.doc('drafts/user-a').set({
        userId: 'user-a',
        content: 'Draft text',
        title: 'Draft title',
      })
    );
    await assertSucceeds(db.doc('drafts/user-a').get());
  });

  it('denies reading another user\'s draft', async () => {
    const dbOwner = testEnv.authenticatedContext('user-a').firestore();
    const dbIntruder = testEnv.authenticatedContext('user-b').firestore();
    await dbOwner.doc('drafts/user-a').set({
      userId: 'user-a',
      content: 'Draft text',
    });
    await assertFails(dbIntruder.doc('drafts/user-a').get());
  });
});

describe('firestore.rules — anonymizedTelemetry', () => {
  it('allows authenticated user to create telemetry', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertSucceeds(
      db.doc('anonymizedTelemetry/tel-1').set({
        telemetryId: 'tel-1',
        sentAt: new Date().toISOString(),
      })
    );
  });

  it('denies updating telemetry (create-only)', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await db.doc('anonymizedTelemetry/tel-1').set({
      telemetryId: 'tel-1',
      sentAt: new Date().toISOString(),
    });
    await assertFails(
      db.doc('anonymizedTelemetry/tel-1').update({ sentAt: 'modified' })
    );
  });

  it('denies deleting telemetry by non-admin', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await db.doc('anonymizedTelemetry/tel-1').set({
      telemetryId: 'tel-1',
      sentAt: new Date().toISOString(),
    });
    await assertFails(db.doc('anonymizedTelemetry/tel-1').delete());
  });

  it('denies unauthenticated telemetry creation', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      db.doc('anonymizedTelemetry/tel-1').set({ telemetryId: 'tel-1' })
    );
  });
});

describe('firestore.rules — aiDailyLimit', () => {
  it('denies client access to aiDailyLimit (admin SDK only)', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(db.doc('aiDailyLimit/user-a').get());
    await assertFails(
      db.doc('aiDailyLimit/user-a').set({ count: 0, date: '2026-06-26' })
    );
  });
});

describe('firestore.rules — aiGlobalDaily', () => {
  it('denies client access to aiGlobalDaily (admin SDK only)', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(db.doc('aiGlobalDaily/2026-06-26').get());
    await assertFails(
      db.doc('aiGlobalDaily/2026-06-26').set({ requests: 0 })
    );
  });
});
