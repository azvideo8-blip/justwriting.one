import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const deleteAccount = onCall({
  enforceAppCheck: true,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required to delete account.');
  }

  const uid = request.auth.uid;
  const db = admin.firestore();

  try {
    // 1. Delete Firestore user document and all subcollections recursively
    const userRef = db.collection('users').doc(uid);
    await db.recursiveDelete(userRef);

    // 2. Delete user-specific top-level documents
    const docRefs = [
      db.collection('drafts').doc(uid),
      db.collection('aiUsage').doc(uid),
      db.collection('aiDailyLimit').doc(uid),
      db.collection('aiCooldown').doc(uid),
    ];

    await Promise.all(
      docRefs.map(ref => ref.delete().catch(() => {/* ignore if doc does not exist */}))
    );

    // 3. Delete Firebase Auth user account
    await admin.auth().deleteUser(uid);

    return { success: true };
  } catch (e) {
    console.error(`[deleteAccount] Failed for uid ${uid}:`, e);
    throw new HttpsError('internal', 'Account deletion failed.');
  }
});
