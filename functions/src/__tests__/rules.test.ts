import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails, type TestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let testEnv: TestEnvironment;

const PROJECT_ID = 'justwriting-test';

beforeAll(async () => {
  // Load the actual firestore.rules (repo root) — without this the emulator
  // defaults to allow-all and every "denies" assertion silently passes.
  const rules = readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });
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

// S-12: isValidDocumentUpdate — hasOnly + type checks
describe('firestore.rules — document updates (S-12)', () => {
  it('allows valid document update with known fields', async () => {
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
    await assertSucceeds(
      db.doc('users/user-a/documents/doc-1').update({
        title: 'Updated title',
        tags: ['tag1'],
        labelId: 'label-1',
        totalWords: 200,
        totalDuration: 120,
        currentVersion: 2,
        sessionsCount: 2,
        lastSessionAt: new Date(),
      })
    );
  });

  it('denies document update with extra field', async () => {
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
    await assertFails(
      db.doc('users/user-a/documents/doc-1').update({
        title: 'Updated',
        userId: 'user-b',
      })
    );
  });

  it('denies cross-user document update', async () => {
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
    await assertFails(
      dbIntruder.doc('users/user-a/documents/doc-1').update({ title: 'hacked' })
    );
  });
});

// S-11: summaries + embeddings validation
describe('firestore.rules — summaries (S-11)', () => {
  const validSummary = {
    documentId: 'doc-1',
    tone: 'reflective',
    frequentWords: ['word1', 'word2'],
    insights: ['insight1'],
    themes: ['theme1'],
    extractedFacts: ['fact1'],
    mentionedPeople: [{ name: 'Alice', role: 'friend' }],
    processedAt: Date.now(),
  };

  it('allows owner to write a valid summary', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertSucceeds(
      db.doc('users/user-a/summaries/doc-1').set(validSummary, { merge: true })
    );
  });

  it('denies summary with extra field', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(
      db.doc('users/user-a/summaries/doc-1').set({
        ...validSummary,
        extraField: 'malicious',
      }, { merge: true })
    );
  });

  it('denies cross-user summary write', async () => {
    const dbIntruder = testEnv.authenticatedContext('user-b').firestore();
    await assertFails(
      dbIntruder.doc('users/user-a/summaries/doc-1').set(validSummary, { merge: true })
    );
  });

  it('denies summary with oversized tone field', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(
      db.doc('users/user-a/summaries/doc-1').set({
        ...validSummary,
        tone: 'x'.repeat(600),
      }, { merge: true })
    );
  });
});

describe('firestore.rules — embeddings (S-11)', () => {
  const validEmbedding = {
    documentId: 'doc-1',
    vectorsJson: JSON.stringify([[0.1, 0.2, 0.3]]),
    chunkTextsJson: JSON.stringify(['chunk text']),
    model: 'text-embedding-3-small',
    dim: 3,
    contentHash: 'abc123',
    processedAt: Date.now(),
    schemaV: 2,
  };

  it('allows owner to write a valid embedding', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertSucceeds(
      db.doc('users/user-a/embeddings/doc-1').set(validEmbedding, { merge: true })
    );
  });

  it('denies embedding with extra field', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(
      db.doc('users/user-a/embeddings/doc-1').set({
        ...validEmbedding,
        extraField: 'malicious',
      }, { merge: true })
    );
  });

  it('denies cross-user embedding write', async () => {
    const dbIntruder = testEnv.authenticatedContext('user-b').firestore();
    await assertFails(
      dbIntruder.doc('users/user-a/embeddings/doc-1').set(validEmbedding, { merge: true })
    );
  });

  it('denies embedding with oversized vectorsJson', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(
      db.doc('users/user-a/embeddings/doc-1').set({
        ...validEmbedding,
        vectorsJson: 'x'.repeat(500001),
      }, { merge: true })
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
        updatedAt: Date.now(),
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
      updatedAt: Date.now(),
    });
    await assertFails(dbIntruder.doc('drafts/user-a').get());
  });
});

describe('firestore.rules — anonymizedTelemetry', () => {
  // SEC-54: anonymizedTelemetry is create/update/delete=false for clients (Admin SDK via sendTelemetry Cloud Function writes)
  const validTelemetry = {
    telemetryId: 'tel-1',
    activeTheme: 'amethyst',
    notesCountBucket: '11-50',
    averageWordCount: 200,
    reasoningRatio: 0.5,
    doorRatios: null,
    sentAt: new Date().toISOString(),
  };

  it('denies direct client creation of telemetry (writes routed via sendTelemetry Cloud Function)', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(
      db.doc('anonymizedTelemetry/tel-1').set(validTelemetry)
    );
  });

  it('denies unauthenticated telemetry creation', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      db.doc('anonymizedTelemetry/tel-1').set(validTelemetry)
    );
  });

  it('allows admin to read anonymizedTelemetry', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('anonymizedTelemetry/tel-1').set(validTelemetry);
    });

    const dbAdmin = testEnv.authenticatedContext('admin-user', { role: 'admin' }).firestore();
    await assertSucceeds(dbAdmin.doc('anonymizedTelemetry/tel-1').get());
  });

  it('denies non-admin from reading anonymizedTelemetry', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('anonymizedTelemetry/tel-1').set(validTelemetry);
    });

    const dbUser = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(dbUser.doc('anonymizedTelemetry/tel-1').get());
  });

  it('denies deleting telemetry even by admin', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc('anonymizedTelemetry/tel-1').set(validTelemetry);
    });

    const dbAdmin = testEnv.authenticatedContext('admin-user', { role: 'admin' }).firestore();
    await assertFails(dbAdmin.doc('anonymizedTelemetry/tel-1').delete());
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
