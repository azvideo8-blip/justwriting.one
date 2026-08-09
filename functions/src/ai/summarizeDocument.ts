import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { firestoreAiContext } from '../shared/aiUtils';
import { AiError } from '../shared/aiContext';
import { summarizeDocumentLogic, validateVerbatimQuote } from './summarizeDocument.logic';

export { validateVerbatimQuote };
export const SUMMARY_SYSTEM_PROMPT = `Проанализируй личную заметку и верни JSON. Отвечай СТРОГО на русском языке.`;

export const summarizeDocument = onCall({
  secrets: ['OPENROUTER_API_KEY'],
  timeoutSeconds: 120,
  enforceAppCheck: true,
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Registration required.');
  try {
    return await summarizeDocumentLogic(firestoreAiContext, request.auth.uid, request.data);
  } catch (e) {
    if (e instanceof AiError) throw new HttpsError(e.code as any, e.message);
    throw e;
  }
});
