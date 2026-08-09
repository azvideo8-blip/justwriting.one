// functions/src/ai/extractChatMemory.logic.ts
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, hasInjectionAttempt } from '../shared/aiUtils';
import { generate } from '../shared/aiProvider';
import { AiError, type AiContext } from '../shared/aiContext';

const inputSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(5_000),
  })).min(1).max(30).refine(
    msgs => msgs.reduce((sum, m) => sum + m.content.length, 0) <= 50_000,
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
Keep each memory unit to 1-2 sentences, phrased in the first person as the user's own words, in the user's language. Return ONLY valid JSON array.`;

const VALID_KINDS = ['fact', 'insight', 'commitment', 'preference'];

export async function extractChatMemoryLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) {
    console.error('[AI memory] validation failed:', JSON.stringify(parsed.error.issues));
    throw new AiError('invalid-argument', 'Invalid payload.');
  }

  if (parsed.data.messages.some(m => hasInjectionAttempt(m.content))) {
    throw new AiError('invalid-argument', 'Disallowed patterns in messages.');
  }

  const allowed = await ctx.checkAndIncrementBulkLimit(uid);
  if (!allowed) {
    throw new AiError('resource-exhausted', 'Daily bulk operations limit reached.');
  }

  const conversationText = parsed.data.messages
    .map(m => `${m.role}: ${sanitizeAiInput(m.content)}`)
    .join('\n\n');

  const reservation = await ctx.tryReserveGlobalRequest(1000);
  if (!reservation) {
    await ctx.refundBulkLimit(uid);
    throw new AiError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

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
      await ctx.refundBulkLimit(uid);
    }

    memories = (Array.isArray(memories) ? memories : []).filter(m =>
      m && typeof m.text === 'string' && typeof m.kind === 'string' && VALID_KINDS.includes(m.kind) && !hasInjectionAttempt(m.text),
    );

    return { memories };
  } catch (e) {
    await ctx.refundBulkLimit(uid);
    await ctx.refundGlobalRequest(reservation);
    console.error('[AI memory] failed:', e);
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new AiError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new AiError('internal', 'Memory extraction failed.');
  }
}
