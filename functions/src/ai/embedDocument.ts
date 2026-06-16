import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, recordUsage, withinGlobalDailyLimit } from '../shared/aiUtils';
import { embed } from '../shared/aiProvider';

const inputSchema = z.object({
  content: z.string().min(1).max(50_000),
});

function meanPool(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const result = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      result[i] += vec[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    result[i] /= vectors.length;
  }
  return result;
}

const CHUNK_CHAR_LIMIT = 6000;

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_CHAR_LIMIT) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_CHAR_LIMIT, text.length);
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > start) end = lastSpace;
    }
    chunks.push(text.slice(start, end));
    start = end;
    while (start < text.length && text[start] === ' ') start++;
  }
  return chunks;
}

export const embedDocument = onCall({
  secrets: ['GEMINI_API_KEY', 'FIREWORKS_API_KEY'],
  timeoutSeconds: 120,
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const uid = request.auth.uid;

  // Embeddings are cheap bulk infrastructure, not user-facing AI calls — they
  // are NOT subject to the per-user daily cap (AI_DAILY_LIMIT, default 5) or the
  // 10s chat cooldown (checkRateLimit), which made bulk indexing impossible
  // (429 / "Daily limit reached"). Only the project-wide cost guard applies.
  if (!(await withinGlobalDailyLimit())) {
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { content } = parsed.data;
  const sanitized = sanitizeAiInput(content);

  try {
    const chunks = chunkText(sanitized);
    const result = await embed(chunks);

    let vector: number[];
    if (result.vectors.length === 1) {
      vector = result.vectors[0];
    } else {
      vector = meanPool(result.vectors);
    }

    recordUsage(uid, result.tokens, 0, { model: result.model, fn: 'embed' }).catch(e =>
      console.error('[AI embed] usage record failed:', e),
    );

    return { vector, model: result.model, dim: result.dim };
  } catch (e) {
    console.error('[AI embed] generation failed:', e);
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new HttpsError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new HttpsError('internal', 'AI embedding failed.');
  }
});
