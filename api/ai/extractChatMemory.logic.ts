// functions/src/ai/extractChatMemory.logic.ts
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, hasInjectionAttempt, isIrrealis, MAX_AI_CONTENT_LENGTH } from './pure';
import { generate } from './provider';
import { AiError, type AiContext } from '../../src/shared/ai/context.js';

import { chargeCall, refundCall } from '../../src/shared/ai/aiPolicy.js';

const inputSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(5_000),
  })).min(1).max(30).refine(
    msgs => msgs.reduce((sum, m) => sum + m.content.length, 0) <= MAX_AI_CONTENT_LENGTH,
    'Total messages content exceeds 50K characters',
  ),
});

const FACET_MODEL = process.env.AI_FACET_MODEL ?? 'deepseek/deepseek-v4-flash';

const SYSTEM_PROMPT = `Extract durable memory units from this conversation. Return JSON array of { kind: 'fact'|'insight'|'commitment'|'preference', text: short description }.

LANGUAGE (MOST IMPORTANT RULE): every memory unit's "text" MUST be written in the SAME language the user writes in the conversation below. These instructions are in English, but that MUST NOT make you write the memory in English — if the user writes in Russian, every "text" must be in Russian. Write the memory as if the user wrote it about themselves, in their language. Never translate the user's words into another language.

CRITICAL — source restriction: record ONLY what the USER actually stated or explicitly agreed with. NEVER store the assistant's own interpretations, metaphors, reframes, hypotheses, or wording as if they were the user's facts or insights. If an idea came from the assistant and the user did not voice or confirm it, DO NOT store it. When in doubt, leave it out — a smaller, user-grounded memory is far better than importing the assistant's narrative.

Focus on:
- Facts about the user's life the USER reported (relationships, work, habits, events)
- Psychological insights the USER voiced or explicitly endorsed (patterns, realizations) — not the assistant's
- Commitments or intentions the USER expressed (goals, plans, decisions)
- Communication preferences: direct feedback the USER gave about the assistant's tone, pacing, style, length, or quality (e.g. 'User dislikes verbose intros', 'User prefers bullet points', 'User wants shorter answers').

CRITICAL — modality: 'fact' is ONLY for what already happened. Anything the user intends, plans, wants, or still has to do is 'commitment', even when stated with full resolve ("I'm definitely buying it this month"). Resolve is not a fact. An offer received is a fact of the offer, never a fact of the purchase. Phrase a commitment as an intention, never as a completed action.

Keep each memory unit to 1-2 sentences, phrased in the first person as the user's own words, in the user's language. Return ONLY valid JSON array.`;

const VALID_KINDS = ['fact', 'insight', 'commitment', 'preference'];

export async function extractChatMemoryLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) {
    console.error('[AI memory] validation failed:', parsed.error.issues.map(i => `${i.path.join('.')}:${i.code}`).join(', '));
    throw new AiError('invalid-argument', 'Invalid payload.');
  }

  if (parsed.data.messages.some(m => hasInjectionAttempt(m.content))) {
    throw new AiError('invalid-argument', 'Disallowed patterns in messages.');
  }

  const callRes = await chargeCall(ctx, uid, 'bulk');

  const conversationText = parsed.data.messages
    .map(m => `${m.role}: ${sanitizeAiInput(m.content)}`)
    .join('\n\n');

  const reservation = await ctx.tryReserveGlobalRequest(1000);
  if (!reservation) {
    await refundCall(ctx, callRes);
    throw new AiError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  let settled = false;
  try {
    const result = await generate({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: conversationText }],
      json: false,
      maxTokens: 1000,
      model: FACET_MODEL,
      abortMs: 50_000,
    });

    ctx.recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'extractMemory' }, reservation).catch(e =>
      console.error('[AI memory] usage record failed:', e),
    );
    settled = true;

    const cleaned = sanitizeAiResponse(result.text).trim();

    let memories: { kind: string; text: string }[] = [];
    try {
      memories = JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          memories = JSON.parse(jsonMatch[0]);
        } catch { /* return empty */ }
      }
    }

    if (!Array.isArray(memories) || memories.length === 0) {
      await refundCall(ctx, callRes);
    }

    // Тот же случай, что и в summarizeDocument: намерение, записанное моделью
    // как 'fact', позже звучит в чате как состоявшееся. Модальность не
    // оставляем на усмотрение модели — переводим в 'commitment' по маркерам.
    memories = (Array.isArray(memories) ? memories : [])
      .filter(m =>
        m != null && typeof m.text === 'string' && typeof m.kind === 'string' && VALID_KINDS.includes(m.kind) && !hasInjectionAttempt(m.text),
      )
      .map(m => (m.kind === 'fact' && isIrrealis(m.text) ? { ...m, kind: 'commitment' } : m));

    return { memories };
  } catch (e) {
    if (!settled) {
      await refundCall(ctx, callRes);
      await ctx.refundGlobalRequest(reservation);
    }
    console.error('[AI memory] failed:', e);
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new AiError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new AiError('internal', 'Memory extraction failed.');
  }
}
