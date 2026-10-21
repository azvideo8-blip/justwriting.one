// functions/src/ai/embedDocument.logic.ts
import { z } from 'zod';
import { sanitizeAiInput, MAX_AI_CONTENT_LENGTH } from './pure';
import { embed } from './provider';
import { AiError, type AiContext } from '../../src/shared/ai/context.js';
import { chargeCall, parseCharge, estimateInputTokens } from '../../src/shared/ai/aiPolicy.js';
import { safeErrorShape } from '../../src/shared/ai/errorShape.js';

const inputSchema = z.object({
  content: z.string().min(1).max(200_000),
});

const CHUNK_CHAR_LIMIT = 1_000;
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS = 200;

/** Окна для индексации: 1000 знаков, перекрытие 150, потолок 200. Экспортировано
 * для стенда замера «связанных дней» (scripts/ai-bench) — самодельная копия
 * нарезки расходится с продом и меряет не то. */
export function chunkText(text: string): string[] {
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

// DA-15: sanitizeAiInput обрезает до MAX_AI_CONTENT_LENGTH (50 000) — для чата это
// потолок разумного, а для индексации хвост длинной заметки просто выпадал из
// поиска. Чистим окнами той же длины и индексируем весь текст (до MAX_CHUNKS).
export function sanitizeWholeText(text: string): string {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += MAX_AI_CONTENT_LENGTH) {
    parts.push(sanitizeAiInput(text.slice(i, i + MAX_AI_CONTENT_LENGTH)));
  }
  return parts.join('');
}

export async function embedDocumentLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) {
    throw new AiError('invalid-argument', 'Invalid payload.');
  }

  const { content } = parsed.data;

  // Обновление профиля помечает свои вызовы `charge: 'user'` и платит из
  // дневного лимита человека; всё остальное — из фонового, как раньше.
  const charge = parseCharge((data as { charge?: unknown } | null)?.charge);
  const callRes = await chargeCall(ctx, uid, charge, 'embed');

  const sanitized = sanitizeWholeText(content);
  const inputEstimate = estimateInputTokens([sanitized]);

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
    const chunks = chunkText(sanitized);
    const result = await embed(chunks);

    if (result.vectors.length !== chunks.length) {
      console.error(`[AI embed] count mismatch: got ${result.vectors.length} for ${chunks.length} chunks.`);
      throw new AiError('internal', 'Embedding failed.');
    }

    callRes.markProduced(result.vectors.length);
    await callRes.settle('done');

    ctx.recordUsage(uid, result.tokens, 0, { model: result.model, fn: 'embed' }, reservation).catch(e =>
      console.error('[AI embed] usage record failed:', safeErrorShape(e)),
    );

    return { vectors: result.vectors, chunks, model: result.model, dim: result.dim };
  } catch (e) {
    await callRes.settle('failed');
    console.error('[AI embed] generation failed:', safeErrorShape(e));
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new AiError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new AiError('internal', 'AI embedding failed.');
  }
}
