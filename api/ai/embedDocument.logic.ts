// functions/src/ai/embedDocument.logic.ts
import { z } from 'zod';
import { sanitizeAiInput } from './pure';
import { embed } from './provider';
import { AiError, type AiContext } from './context';
import { chargeCall, refundCall, parseCharge } from './policy';

const inputSchema = z.object({
  content: z.string().min(1).max(200_000),
});

const CHUNK_CHAR_LIMIT = 1_000;
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS = 200;

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

export async function embedDocumentLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) {
    throw new AiError('invalid-argument', 'Invalid payload.');
  }

  const { content } = parsed.data;

  // Обновление профиля помечает свои вызовы `charge: 'user'` и платит из
  // дневного лимита человека; всё остальное — из фонового, как раньше.
  const charge = parseCharge((data as { charge?: unknown } | null)?.charge);
  const callRes = await chargeCall(ctx, uid, charge);

  const sanitized = sanitizeAiInput(content);

  const reservation = await ctx.tryReserveGlobalRequest(512);
  if (!reservation) {
    await refundCall(ctx, callRes);
    throw new AiError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  let settled = false;
  try {
    const chunks = chunkText(sanitized);
    const result = await embed(chunks);

    if (result.vectors.length !== chunks.length) {
      console.error(`[AI embed] count mismatch: got ${result.vectors.length} for ${chunks.length} chunks.`);
      throw new AiError('internal', 'Embedding failed.');
    }

    ctx.recordUsage(uid, result.tokens, 0, { model: result.model, fn: 'embed' }, reservation).catch(e =>
      console.error('[AI embed] usage record failed:', e),
    );
    settled = true;

    return { vectors: result.vectors, chunks, model: result.model, dim: result.dim };
  } catch (e) {
    if (!settled) {
      await refundCall(ctx, callRes);
      await ctx.refundGlobalRequest(reservation);
    }
    console.error('[AI embed] generation failed:', e);
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new AiError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new AiError('internal', 'AI embedding failed.');
  }
}
