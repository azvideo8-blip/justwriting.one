import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getDailyLimitCount, DAILY_LIMIT } from '../shared/aiUtils';

export const getAILimit = onCall({
  enforceAppCheck: true,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const uid = request.auth.uid;
  const { used, date } = await getDailyLimitCount(uid);

  return {
    used,
    limit: DAILY_LIMIT,
    date,
  };
});
