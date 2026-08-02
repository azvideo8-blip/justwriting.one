import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails, type TestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SUMMARY_CLOUD_FIELDS,
  EMBEDDING_CLOUD_FIELDS,
  DRAFT_CLOUD_FIELDS,
  USER_PROFILE_CLOUD_FIELDS,
  DOCUMENT_CLOUD_FIELDS,
  VERSION_CLOUD_FIELDS,
} from '../../../src/core/firebase/cloudFields';

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

  // uuid is immutable: once set, it cannot be changed.  The migration
  // manifest keys on uuid; a changed identity would orphan the manifest
  // entry.
  it('denies changing an existing document uuid', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await db.doc('users/user-a/documents/doc-1').set({
      userId: 'user-a',
      title: 'My note',
      uuid: 'original-uuid',
      currentVersion: 1,
      totalWords: 100,
      totalDuration: 60,
      sessionsCount: 1,
      firstSessionAt: new Date(),
      lastSessionAt: new Date(),
    });
    await assertFails(
      db.doc('users/user-a/documents/doc-1').update({
        uuid: 'different-uuid',
      })
    );
  });

  // Setting uuid on a document that never had one is allowed — this is how
  // backfill works for notes created before C1.1.
  it('allows setting uuid on a document that has none', async () => {
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
        uuid: 'newly-assigned-uuid',
      })
    );
  });

  // Writing the same uuid that already exists is a no-op and must be allowed.
  it('allows writing the same uuid (idempotent)', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await db.doc('users/user-a/documents/doc-1').set({
      userId: 'user-a',
      title: 'My note',
      uuid: 'keep-me',
      currentVersion: 1,
      totalWords: 100,
      totalDuration: 60,
      sessionsCount: 1,
      firstSessionAt: new Date(),
      lastSessionAt: new Date(),
    });
    await assertSucceeds(
      db.doc('users/user-a/documents/doc-1').update({
        uuid: 'keep-me',
        title: 'Updated title',
      })
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

  // The fixture above is a shape this file invented. The client spreads the
  // whole AIDocumentSummary and encrypts it, which is what actually hits the
  // rule — and what the old field list rejected, silently stopping every
  // summary from reaching the cloud.
  it('allows the encrypted shape the client actually sends', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertSucceeds(
      db.doc('users/user-a/summaries/doc-1').set({
        documentId: 'doc-1',
        tone: 'ciphertext',
        echo: 'ciphertext',
        eventDate: 'ciphertext',
        quotableSentence: 'ciphertext',
        contentHash: 'ciphertext',
        frequentWords: 'ciphertext-of-the-whole-array',
        authorPhrases: 'ciphertext-of-the-whole-array',
        insights: 'ciphertext-of-the-whole-array',
        themes: 'ciphertext-of-the-whole-array',
        extractedFacts: 'ciphertext-of-the-whole-array',
        commitments: 'ciphertext-of-the-whole-array',
        mentionedPeople: [{ name: 'Alice', role: 'friend' }],
        processedAt: Date.now(),
        valence: 0.4,
        arousal: 0.2,
        promptVersion: 2,
        _encrypted: true,
      }, { merge: true })
    );
  });

  it('allows the plaintext v2 fields when encryption is off', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertSucceeds(
      db.doc('users/user-a/summaries/doc-1').set({
        ...validSummary,
        authorPhrases: ['по-моему'],
        quotableSentence: 'A sentence.',
        commitments: ['do the thing'],
        valence: -0.3,
        arousal: 0.8,
        echo: 'echo',
        eventDate: '2026-07-28',
        contentHash: 'abc123',
        promptVersion: 2,
        summary: 'A short summary.',
      }, { merge: true })
    );
  });

  it('denies cross-user summary write', async () => {
    const dbIntruder = testEnv.authenticatedContext('user-b').firestore();
    await assertFails(
      dbIntruder.doc('users/user-a/summaries/doc-1').set(validSummary, { merge: true })
    );
  });

  // The cap was raised from 500 to 5000 because `tone` is encrypted before it
  // is sent, and the ciphertext of a 500-char tone is well past 500 chars.
  it('denies summary with oversized tone field', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(
      db.doc('users/user-a/summaries/doc-1').set({
        ...validSummary,
        tone: 'x'.repeat(5001),
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

  // qwen3-embedding-8b returns 4096 dims, so a multi-chunk note produces a
  // ciphertext far past the old 500k cap while still under the size the client
  // is willing to send — the gap showed up as permission-denied on sync.
  it('accepts an embedding at the size the client is willing to send', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertSucceeds(
      db.doc('users/user-a/embeddings/doc-big').set({
        ...validEmbedding,
        vectorsJson: 'x'.repeat(700_000),
        dim: 4096,
        model: 'ciphertext',
        contentHash: 'ciphertext',
        _encrypted: true,
      }, { merge: true })
    );
  });

  it('still denies an embedding past the client-side size limit', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(
      db.doc('users/user-a/embeddings/doc-huge').set({
        ...validEmbedding,
        vectorsJson: 'x'.repeat(1_000_001),
      }, { merge: true })
    );
  });

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

  // Cap raised to 1,000,000 to match MAX_CLOUD_EMBEDDING_BYTES on the client;
  // the "still denies" case above covers the boundary.
  it('denies embedding with oversized vectorsJson', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(
      db.doc('users/user-a/embeddings/doc-1').set({
        ...validEmbedding,
        vectorsJson: 'x'.repeat(1_000_001),
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

  // Admin read used to be allowed here while update and delete were owner-only.
  // A compromised admin claim could then read every user's drafts; support work
  // goes through the Admin SDK, which is audited, so the client path has no
  // reason to reach another user's draft.
  it('denies an admin reading another user\'s draft', async () => {
    const dbOwner = testEnv.authenticatedContext('user-a').firestore();
    await dbOwner.doc('drafts/user-a').set({
      userId: 'user-a',
      content: 'Draft text',
      updatedAt: Date.now(),
    });
    const dbAdmin = testEnv.authenticatedContext('admin-1', { role: 'admin' }).firestore();
    await assertFails(dbAdmin.doc('drafts/user-a').get());
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

  // The tests above send a shape this file invented, never the one the client
  // actually produces. With E2E encryption on, maybeEncrypt() turns the whole
  // pinnedThoughts array into a ciphertext STRING, which the original
  // `is list` check rejected — every autosave failed with permission-denied
  // while these tests stayed green.
  it('allows an encrypted draft whose pinnedThoughts is a ciphertext string', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertSucceeds(
      db.doc('drafts/user-a').set({
        userId: 'user-a',
        content: 'ciphertext-blob',
        title: '',
        pinnedThoughts: 'ciphertext-blob-for-the-whole-array',
        _encrypted: true,
        updatedAt: Date.now(),
      })
    );
  });

  it('still accepts a plaintext pinnedThoughts list', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertSucceeds(
      db.doc('drafts/user-a').set({
        userId: 'user-a',
        content: 'Draft text',
        pinnedThoughts: ['a thought', 'another'],
        updatedAt: Date.now(),
      })
    );
  });

  it('denies a pinnedThoughts string when the draft is not marked encrypted', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(
      db.doc('drafts/user-a').set({
        userId: 'user-a',
        content: 'Draft text',
        pinnedThoughts: 'not a list and not encrypted',
        updatedAt: Date.now(),
      })
    );
  });

  it('denies a plaintext pinnedThoughts list over the item cap', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(
      db.doc('drafts/user-a').set({
        userId: 'user-a',
        content: 'Draft text',
        pinnedThoughts: Array.from({ length: 21 }, (_, i) => `thought ${i}`),
        updatedAt: Date.now(),
      })
    );
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

describe('firestore.rules — contract', () => {
  it('has matching field sets for all collections', () => {
    const rules = readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8');

    function extractHasOnly(funcName: string): Set<string> {
      // Take the first hasOnly() after the declaration rather than trying to
      // capture the body: a rule comment containing braces (isValidEmbedding
      // mentions `setDoc({merge:true})`) truncates any non-greedy body match
      // before the field list, and the failure looks like a missing rule.
      const declIndex = rules.search(new RegExp(`function\\s+${funcName}\\s*\\(`));
      if (declIndex === -1) throw new Error(`Function ${funcName} not found in rules`);
      const body = rules.slice(declIndex);
      const hasOnlyMatch = body.match(/hasOnly\(\s*\[(.*?)\]\s*\)/s);
      if (!hasOnlyMatch) throw new Error(`hasOnly list not found in ${funcName}`);
      const fieldsStr = hasOnlyMatch[1];
      const fields = fieldsStr.match(/'(.*?)'/g)?.map(s => s.replace(/'/g, '')) ?? [];
      return new Set(fields);
    }

    const testContract = (funcName: string, cloudFields: object) => {
      const ruleFields = extractHasOnly(funcName);
      const codeFields = new Set(Object.keys(cloudFields));
      
      const missingInRules = [...codeFields].filter(f => !ruleFields.has(f));
      const missingInCode = [...ruleFields].filter(f => !codeFields.has(f));
      
      expect(missingInRules, `${funcName}: missing in rules (but sent by client)`).toEqual([]);
      expect(missingInCode, `${funcName}: missing in client code (but allowed by rules)`).toEqual([]);
    };

    testContract('isValidSummary', SUMMARY_CLOUD_FIELDS);
    testContract('isValidEmbedding', EMBEDDING_CLOUD_FIELDS);
    testContract('isValidDraft', DRAFT_CLOUD_FIELDS);
    testContract('isValidUserCreate', USER_PROFILE_CLOUD_FIELDS);
    testContract('isValidDocumentUpdate', DOCUMENT_CLOUD_FIELDS);
    testContract('isValidVersion', VERSION_CLOUD_FIELDS);
  });
});

describe('firestore.rules — maximal documents', () => {
  const db = () => testEnv.authenticatedContext('user-a').firestore();
  const ts = new Date().getTime();

  // Fixtures are BUILT FROM the cloud-field constants, never hand-written: a
  // hand-written maximal document drifts from the constant the moment a field
  // is added, which is the drift this whole contract exists to stop.
  const VALUE: Record<string, unknown> = {
    // ids / plain strings
    documentId: 'doc-1', userId: 'user-a', uid: 'user-a', title: 't',
    email: 'test@example.com', nickname: 'n', summary: 's', tone: 'neutral',
    quotableSentence: 'q', echo: 'e', contentHash: 'h', eventDate: '2026-07-28',
    labelId: 'l', activeSessionId: 'sess', savedDocumentId: 'doc-1', mood: 'm',
    model: 'm', content: 'c', aiPortrait: 'p', encryptionSalt: 's',
    encryptedDataKey: 'k',
    // json-encoded blobs
    vectorsJson: '[]', vectorJson: '[]', chunkTextsJson: '[]',
    // numbers
    processedAt: ts, updatedAt: ts, valence: 0, arousal: 0, promptVersion: 1,
    seconds: 1, wpm: 1, wordCount: 1, initialWordCount: 1, sessionStartTime: ts,
    accumulatedDuration: 1, totalPauseSeconds: 1, dim: 1, schemaV: 1,
    version: 1, wordsAdded: 1, charsAdded: 1, duration: 1, goalWords: 1,
    goalTime: 1, currentVersion: 1, sessionsCount: 1, totalWords: 1,
    totalDuration: 1, totalWordCount: 1, streakDays: 1, avgWpm: 1,
    avgSessionWords: 1, privacyVersion: 1,
    // booleans
    goalReached: true, _encrypted: true,
    // lists
    tags: ['tag'], pinnedThoughts: ['p'], frequentWords: ['a'],
    authorPhrases: ['b'], insights: ['c'], themes: ['e'], extractedFacts: ['f'],
    commitments: ['h'], labels: [], earnedAchievements: [],
    mentionedPeople: [{ name: 'Alice', role: 'friend' }],
    // timestamps / maps
    savedAt: new Date(), sessionStartedAt: new Date(), firstSessionAt: new Date(),
    lastSessionAt: new Date(), privacyAcceptedAt: new Date(), encryptionMeta: {},
  };

  function build(fields: object, opts?: { cipher?: string[]; omit?: string[]; over?: Record<string, unknown> }) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(fields)) {
      if (opts?.omit?.includes(key)) continue;
      if (!(key in VALUE)) throw new Error(`No test value for field "${key}" — add one to VALUE`);
      // maybeEncrypt JSON-stringifies each array field into one ciphertext
      // string, so encrypted arrays arrive as strings, not lists.
      out[key] = opts?.cipher?.includes(key) ? 'ciphertext' : VALUE[key];
    }
    return { ...out, ...(opts?.over ?? {}) };
  }

  // Mirrors the field lists in the services that call maybeEncrypt.
  const SUMMARY_CIPHER = ['tone', 'echo', 'eventDate', 'quotableSentence',
    'frequentWords', 'authorPhrases', 'insights', 'themes', 'extractedFacts', 'commitments'];

  it('allows maximal summary (plaintext)', async () => {
    await assertSucceeds(db().doc('users/user-a/summaries/doc-1')
      .set(build(SUMMARY_CLOUD_FIELDS, { omit: ['_encrypted'] })));
  });

  it('allows maximal summary (encrypted)', async () => {
    await assertSucceeds(db().doc('users/user-a/summaries/doc-2')
      .set(build(SUMMARY_CLOUD_FIELDS, { cipher: SUMMARY_CIPHER })));
  });

  it('allows maximal embedding', async () => {
    await assertSucceeds(db().doc('users/user-a/embeddings/doc-1')
      .set(build(EMBEDDING_CLOUD_FIELDS, { cipher: ['vectorsJson', 'chunkTextsJson', 'model', 'contentHash'] })));
  });

  it('allows maximal draft (plaintext)', async () => {
    await assertSucceeds(db().doc('drafts/user-a')
      .set(build(DRAFT_CLOUD_FIELDS, { omit: ['_encrypted'] })));
  });

  it('allows maximal draft (encrypted)', async () => {
    await assertSucceeds(db().doc('drafts/user-a')
      .set(build(DRAFT_CLOUD_FIELDS, { cipher: ['content', 'pinnedThoughts'] })));
  });

  it('allows maximal user profile', async () => {
    const dbC = testEnv.authenticatedContext('user-c').firestore();
    await assertSucceeds(dbC.doc('users/user-c')
      .set(build(USER_PROFILE_CLOUD_FIELDS, { over: { uid: 'user-c' } })));
  });

  it('allows maximal document update', async () => {
    const ref = db().doc('users/user-a/documents/doc-max');
    await assertSucceeds(ref.set({ userId: 'user-a', title: 't' }));
    await assertSucceeds(ref.set(build(DOCUMENT_CLOUD_FIELDS)));
  });

  it('allows maximal version', async () => {
    await assertSucceeds(db().doc('users/user-a/documents/doc-max/versions/v1')
      .set(build(VERSION_CLOUD_FIELDS, { cipher: ['content'] })));
  });
});
