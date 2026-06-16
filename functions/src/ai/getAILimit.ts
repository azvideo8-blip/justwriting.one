import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getDailyLimitCount, getUserDailyLimit } from '../shared/aiUtils';

export const getAILimit = onCall({
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const uid = request.auth.uid;
  const [{ used, date }, limit] = await Promise.all([
    getDailyLimitCount(uid),
    getUserDailyLimit(uid),
  ]);

  return {
    used,
    limit,
    date,
  };
});
