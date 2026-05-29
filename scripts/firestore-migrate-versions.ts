#!/usr/bin/env npx tsx
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();

const db = getFirestore();

async function migrateLegacySessionsToDocuments(): Promise<void> {
  const sessionsSnap = await db.collection('sessions').limit(500).get();

  let migrated = 0;
  let skipped = 0;

  for (const sessionDoc of sessionsSnap.docs) {
    const session = sessionDoc.data();
    const userId = session.userId;
    if (!userId) { skipped++; continue; }

    const existingDocs = await db.collection('users').doc(userId).collection('documents')
      .where('title', '==', session.title || '').limit(1).get();

    if (!existingDocs.empty) { skipped++; continue; }

    const docRef = await db.collection('users').doc(userId).collection('documents').add({
      userId,
      title: session.title || '',
      currentVersion: 1,
      totalWords: session.wordCount || 0,
      totalDuration: session.duration || 0,
      sessionsCount: 1,
      firstSessionAt: session.createdAt,
      lastSessionAt: session.createdAt,
      tags: session.tags || [],
      labelId: session.labelId || null,
    });

    await docRef.collection('versions').add({
      documentId: docRef.id,
      userId,
      version: 1,
      content: session.content || '',
      wordCount: session.wordCount || 0,
      wordsAdded: session.wordCount || 0,
      charsAdded: (session.content || '').length,
      duration: session.duration || 0,
      wpm: session.wpm || 0,
      savedAt: session.createdAt,
      sessionStartedAt: session.sessionStartTime ?? session.createdAt,
      _encrypted: session._encrypted || false,
    });

    migrated++;
    console.log(`Migrated session ${sessionDoc.id} → document ${docRef.id}`);
  }

  console.log(`\nDone: ${migrated} migrated, ${skipped} skipped`);
}

migrateLegacySessionsToDocuments().catch(console.error);
