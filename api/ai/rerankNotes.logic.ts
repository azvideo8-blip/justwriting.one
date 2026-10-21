// functions/src/ai/rerankNotes.logic.ts
import { z } from 'zod';
import { sanitizeAiInput, hasInjectionAttempt } from './pure';
import { generate } from './provider';
import { AiError, type AiContext } from '../../src/shared/ai/context.js';
import { estimateInputTokens, chargeCall } from '../../src/shared/ai/aiPolicy.js';
import { safeErrorShape } from '../../src/shared/ai/errorShape.js';
// SA-7: промпт, форма user-сообщения и разбор ответа — в общем модуле, оттуда
// же их берёт харнес scripts/rerank-bench/. Копия в харнесе расходится с продом
// молча и незаметно.
import {
  RERANK_SYSTEM_PROMPT,
  buildRerankUserMessage,
  parseRerankSelection,
  RerankResponseError,
} from '../../src/shared/ai/rerankPrompt.js';

const inputSchema = z.object({
  query: z.string().min(1).max(2_000),
  candidates: z.array(z.object({
    documentId: z.string().min(1).max(200),
    card: z.string().max(4_000),
  })).min(1).max(50),
  maxResults: z.number().int().min(1).max(20).optional(),
});

export async function rerankNotesLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) {
    throw new AiError('invalid-argument', 'Invalid payload.');
  }
  const { query, candidates, maxResults = 5 } = parsed.data;

  if (hasInjectionAttempt(query)) {
    throw new AiError('invalid-argument', 'Disallowed patterns in query.');
  }

  const DOC_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
  if (candidates.some(c => !DOC_ID_RE.test(c.documentId))) {
    throw new AiError('invalid-argument', 'Invalid documentId in candidates.');
  }

  // DUP-1: Unified reservation lifetime
  const callRes = await chargeCall(ctx, uid, 'bulk', 'rerank');

  const safeQuery = sanitizeAiInput(query);
  const cardsText = candidates
    .map((c, i) => `[${i + 1}]\n${sanitizeAiInput(c.card)}`)
    .join('\n\n');

  // AUD-19 & FU-4: вход (запрос + карточки) тоже уходит в резерв.
  // Составная квота: allowance = 512 + inputEstimate.
  const inputEstimate = estimateInputTokens([query, cardsText]);
  const reservation = await ctx.tryReserveGlobalRequest(512 + inputEstimate);
  if (reservation && 'error' in reservation) {
    await callRes.settle('failed');
    throw new AiError('unavailable', 'Database temporarily unavailable.');
  }
  if (!reservation) {
    await callRes.settle('failed');
    throw new AiError('resource-exhausted', 'The app-wide daily AI limit is reached. Try again tomorrow.');
  }
  callRes.attachGlobalReservation(reservation, inputEstimate);

  try {
    const result = await generate({
      system: RERANK_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: buildRerankUserMessage(safeQuery, cardsText, maxResults),
      }],
      maxTokens: 512,
      abortMs: 50_000,
    });

    callRes.markProduced(result.text.length);

    let ids: string[];
    try {
      ids = parseRerankSelection(result.text, candidates.map(c => c.documentId), maxResults);
    } catch (err) {
      if (!(err instanceof RerankResponseError)) throw err;
      await callRes.settle('failed', { tokensIn: result.tokensIn, tokensOut: result.tokensOut, model: result.model });
      throw new AiError('internal', err.message);
    }

    await callRes.settle('done');
    ctx.recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'rerank' }, reservation).catch(e =>
      console.error('[AI rerank] usage record failed:', safeErrorShape(e)),
    );

    return { documentIds: ids.slice(0, maxResults) };
  } catch (e) {
    await callRes.settle('failed');
    if (e instanceof AiError) {
      throw e;
    }
    console.error('[AI rerank] failed:', safeErrorShape(e));
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new AiError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new AiError('internal', 'Rerank failed.');
  }
}
