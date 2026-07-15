import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, tryReserveGlobalRequest, refundGlobalRequest, hasInjectionAttempt, checkAndIncrementBulkLimit, refundBulkLimit } from '../shared/aiUtils';
import { generate } from '../shared/aiProvider';

// Extracts durable memory units (facts, insights, commitments, preferences)
// from a finished dialogue. Like summarizeFacet this is profile infrastructure
// — guarded only by the project-wide cost cap, not per-user chat limits.

const inputSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(10_000),
  })).min(1).max(50),
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

export const extractChatMemory = onCall({
  secrets: ['OPENROUTER_API_KEY'],
  timeoutSeconds: 60,
  enforceAppCheck: true,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }
  const uid = request.auth.uid;

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    console.error('[AI memory] validation failed:', JSON.stringify(parsed.error.issues));
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  // Bulk daily limit check
  const allowed = await checkAndIncrementBulkLimit(uid);
  if (!allowed) {
    throw new HttpsError('resource-exhausted', 'Daily bulk operations limit reached.');
  }

  if (parsed.data.messages.some(m => hasInjectionAttempt(m.content))) {
    throw new HttpsError('invalid-argument', 'Disallowed patterns in messages.');
  }

  const conversationText = parsed.data.messages
    .map(m => `${m.role}: ${sanitizeAiInput(m.content)}`)
    .join('\n\n');

  const reservation = await tryReserveGlobalRequest(1000);
  if (!reservation) {
    await refundBulkLimit(uid);
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
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

    recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'extractMemory' }, reservation).catch(e =>
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
      await refundBulkLimit(uid);
    }

    memories = (Array.isArray(memories) ? memories : []).filter(m =>
      m && typeof m.text === 'string' && typeof m.kind === 'string' && VALID_KINDS.includes(m.kind),
    );

    return { memories };
  } catch (e) {
    await refundBulkLimit(uid);
    await refundGlobalRequest(reservation);
    console.error('[AI memory] failed:', e);
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new HttpsError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new HttpsError('internal', 'Memory extraction failed.');
  }
});
