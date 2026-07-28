import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getDb } from '../shared/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as logger from 'firebase-functions/logger';

/**
 * Reconciles the caller's own `role` custom claim with their Firestore profile.
 *
 * Why this is not a privilege-escalation path: the Firestore `role` field is
 * server-controlled. firestore.rules reject it on create (`!('role' in data)`)
 * and on update (`affectedKeys().hasAny(['role', ...])`), so the only writers
 * are setUserRole and the console. Trusting that field to derive the claim is
 * exactly what setUserRole, aiUtils and getAIUsageStats already do.
 *
 * It exists because setUserRole — the only code that ever writes the claim —
 * refuses to change the caller's own role. A first admin promoted directly in
 * the console therefore has the field but no claim, and once authorization
 * moved onto the claim (0.7.63) they lost admin access with no way to restore
 * it: granting the claim required already holding it.
 */
export const syncMyAdminClaim = onCall({
  enforceAppCheck: true,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const uid = request.auth.uid;

  const snap = await getDb().doc(`users/${uid}`).get();
  const fieldIsAdmin = snap.exists && snap.data()?.role === 'admin';

  const user = await getAuth().getUser(uid);
  const claims = user.customClaims ?? {};
  const claimIsAdmin = claims.role === 'admin';

  if (fieldIsAdmin === claimIsAdmin) {
    return { changed: false, isAdmin: claimIsAdmin };
  }

  if (fieldIsAdmin) {
    await getAuth().setCustomUserClaims(uid, { ...claims, role: 'admin' });
    logger.info('Admin claim granted from profile field', { uid });
    // The caller must refresh their ID token to observe it.
    return { changed: true, isAdmin: true };
  }

  // Claim says admin, the profile field does not — drop it. Reached when
  // setUserRole wrote Firestore but died before updating the claim.
  const { role: _dropped, ...rest } = claims;
  await getAuth().setCustomUserClaims(uid, rest);
  await getAuth().revokeRefreshTokens(uid);
  logger.warn('Stale admin claim revoked: profile field is not admin', { uid });
  return { changed: true, isAdmin: false };
});
