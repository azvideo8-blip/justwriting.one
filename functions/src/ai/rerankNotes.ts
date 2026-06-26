import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, recordUsage, tryReserveGlobalRequest, refundGlobalRequest } from '../shared/aiUtils';
import { generate } from '../shared/aiProvider';

// Reranking is search infrastructure, not a user conversation — like embedDocument
// it is NOT subject to the per-user daily cap or chat cooldown (those caused 429s
// and burned the chat quota on every search). Only the project cost guard applies.

const inputSchema = z.object({
  query: z.string().min(1).max(2_000),
  candidates: z.array(z.object({
    documentId: z.string().min(1).max(200),
    card: z.string().max(4_000),
  })).min(1).max(50),
  maxResults: z.number().int().min(1).max(20).optional(),
});

const SYSTEM_PROMPT = 'Ты — модуль ранжирования заметок. По запросу пользователя и списку заметок-кандидатов выбери самые релевантные по смыслу и намерению запроса. Верни ТОЛЬКО валидный JSON-объект вида {"ids":["docId1","docId2"]} — массив выбранных documentId по убыванию релевантности, без пояснений.';

export const rerankNotes = onCall({
  secrets: ['GEMINI_API_KEY', 'FIREWORKS_API_KEY'],
  timeoutSeconds: 60,
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }
  const uid = request.auth.uid;

  if (!(await tryReserveGlobalRequest())) {
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }
  const { query, candidates, maxResults = 5 } = parsed.data;

  const safeQuery = sanitizeAiInput(query);
  const cardsText = candidates
    .map((c, i) => `[${i + 1}] docId=${c.documentId}\n${sanitizeAiInput(c.card)}`)
    .join('\n\n');

  try {
    const result = await generate({
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Запрос пользователя: "${safeQuery}"\n\nКандидаты-заметки:\n${cardsText}\n\nВыбери до ${maxResults} самых релевантных. Верни только {"ids":[...]}.`,
      }],
      json: true,
      maxTokens: 512,
      abortMs: 50_000,
    });

    recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'rerank' }).catch(e =>
      console.error('[AI rerank] usage record failed:', e),
    );

    let ids: string[] = [];
    try {
      const obj = JSON.parse(result.text) as { ids?: unknown };
      if (Array.isArray(obj.ids)) ids = obj.ids.filter((x): x is string => typeof x === 'string');
    } catch {
      ids = [];
    }

    return { documentIds: ids.slice(0, maxResults) };
  } catch (e) {
    await refundGlobalRequest();
    console.error('[AI rerank] failed:', e);
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new HttpsError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new HttpsError('internal', 'Rerank failed.');
  }
});
