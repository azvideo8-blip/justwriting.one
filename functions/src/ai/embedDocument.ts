import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, recordUsage, tryReserveGlobalRequest, refundGlobalRequest, checkAndIncrementBulkLimit, refundBulkLimit } from '../shared/aiUtils';
import { embed } from '../shared/aiProvider';

const inputSchema = z.object({
  content: z.string().min(1).max(50_000),
});

// Small overlapping chunks so a brief mention inside a long note still produces
// a strongly-matching vector (one mean-pooled vector per note diluted those).
const CHUNK_CHAR_LIMIT = 1_000;
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS = 40;

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_CHAR_LIMIT) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(start + CHUNK_CHAR_LIMIT, text.length);
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > start + CHUNK_CHAR_LIMIT / 2) end = lastSpace;
    }
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks.filter(c => c.length > 0);
}

export const embedDocument = onCall({
  secrets: ['OPENROUTER_API_KEY'],
  timeoutSeconds: 120,
  enforceAppCheck: true,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const uid = request.auth.uid;

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { content } = parsed.data;

  // Bulk daily limit check
  const allowed = await checkAndIncrementBulkLimit(uid);
  if (!allowed) {
    throw new HttpsError('resource-exhausted', 'Daily bulk operations limit reached.');
  }

  const sanitized = sanitizeAiInput(content);

  const reservation = await tryReserveGlobalRequest(512);
  if (!reservation) {
    await refundBulkLimit(uid);
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  try {
    const chunks = chunkText(sanitized);
    const result = await embed(chunks);

    if (result.vectors.length !== chunks.length) {
      throw new HttpsError('internal', `Embedding count mismatch: got ${result.vectors.length} for ${chunks.length} chunks.`);
    }

    recordUsage(uid, result.tokens, 0, { model: result.model, fn: 'embed' }, reservation).catch(e =>
      console.error('[AI embed] usage record failed:', e),
    );

    // Return one vector per chunk plus the chunk texts, so the client can assign
    // individual chunks to profile domains and summarize a domain from its own
    // excerpts (a note's chunks may belong to different domains).
    return { vectors: result.vectors, chunks, model: result.model, dim: result.dim };
  } catch (e) {
    await refundBulkLimit(uid);
    await refundGlobalRequest(reservation);
    console.error('[AI embed] generation failed:', e);
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new HttpsError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new HttpsError('internal', 'AI embedding failed.');
  }
});
