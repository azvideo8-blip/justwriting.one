// Шаг «найди опоры» хода с осторожной гипотезой (флаг chat_hypotheses).
// Служебный вызов: списывается из пула фоновых операций, а не из квоты чата —
// гипотеза не должна съедать разговор (как ранжирование и авто-название).
import { z } from 'zod';
import { sanitizeAiInput, hasInjectionAttempt } from './pure';
import { generate } from './provider';
import { AiError, type AiContext } from '../../src/shared/ai/context.js';
import { estimateInputTokens, chargeCall } from '../../src/shared/ai/aiPolicy.js';
import { safeErrorShape } from '../../src/shared/ai/errorShape.js';
import {
  ANCHOR_PICK_SYSTEM_PROMPT,
  ANCHOR_PICK_MAX_CANDIDATES,
  ANCHOR_PICK_MAX_TOKENS,
  ANCHOR_PICK_TEXT_MAX,
  buildAnchorPickUserMessage,
  parseAnchorPick,
} from '../../src/shared/ai/anchorPickPrompt.js';

const inputSchema = z.object({
  message: z.string().min(1).max(2_000),
  candidates: z.array(z.object({
    documentId: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().max(300),
    text: z.string().min(1).max(ANCHOR_PICK_TEXT_MAX),
  })).min(2).max(ANCHOR_PICK_MAX_CANDIDATES),
});

export async function pickAnchorsLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) throw new AiError('invalid-argument', 'Invalid payload.');
  const { message } = parsed.data;
  if (hasInjectionAttempt(message)) throw new AiError('invalid-argument', 'Disallowed patterns in query.');

  // Сверка отрывков идёт с тем же текстом, который видела модель.
  const candidates = parsed.data.candidates.map(c => ({ ...c, title: sanitizeAiInput(c.title), text: sanitizeAiInput(c.text) }));
  const userMessage = buildAnchorPickUserMessage(sanitizeAiInput(message), candidates);

  const callRes = await chargeCall(ctx, uid, 'bulk', 'pick_anchors');
  const inputEstimate = estimateInputTokens([userMessage]);
  const reservation = await ctx.tryReserveGlobalRequest(ANCHOR_PICK_MAX_TOKENS + inputEstimate);
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
      system: ANCHOR_PICK_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: ANCHOR_PICK_MAX_TOKENS,
      abortMs: 25_000,
    });
    callRes.markProduced(result.text.length);
    await callRes.settle('done');
    ctx.recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'pick_anchors' }, reservation).catch(e =>
      console.error('[AI pickAnchors] usage record failed:', safeErrorShape(e)),
    );
    // Не JSON или отрывок не из записи — пустой список: ход идёт без гипотезы.
    return { anchors: parseAnchorPick(result.text, candidates) };
  } catch (e) {
    await callRes.settle('failed');
    if (e instanceof AiError) throw e;
    console.error('[AI pickAnchors] failed:', safeErrorShape(e));
    throw new AiError('internal', 'Anchor pick failed.');
  }
}
