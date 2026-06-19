import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, withinGlobalDailyLimit } from '../shared/aiUtils';
import { generate } from '../shared/aiProvider';

// Extracts durable memory units (facts, insights, commitments, preferences)
// from a finished dialogue. Like summarizeFacet this is profile infrastructure
// — guarded only by the project-wide cost cap, not per-user chat limits.

const inputSchema = z.object({
  messages: z.array(z.object({
    role: z.string().max(20),
    content: z.string().max(10_000),
  })).min(1).max(50),
});

const FACET_MODEL = process.env.AI_FACET_MODEL ?? 'accounts/fireworks/models/gpt-oss-20b';

const SYSTEM_PROMPT = `Extract durable memory units from this conversation. Return JSON array of { kind: 'fact'|'insight'|'commitment'|'preference', text: short description }. Focus on:
- Facts about the user's life (relationships, work, habits, events)
- Psychological insights discovered (patterns, realizations, emotional themes)
- Commitments or intentions the user expressed (goals, plans, decisions)
- Communication preferences: pay special attention to direct feedback about the assistant's tone, pacing, style, length, or quality of answers (e.g. 'User dislikes verbose intros', 'User prefers bullet points', 'User found CBT approach helpful', 'User wants shorter answers').
Keep each memory unit to 1-2 sentences. Return ONLY valid JSON array.`;

const VALID_KINDS = ['fact', 'insight', 'commitment', 'preference'];

export const extractChatMemory = onCall({
  secrets: ['GEMINI_API_KEY', 'FIREWORKS_API_KEY'],
  timeoutSeconds: 60,
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }
  const uid = request.auth.uid;

  if (!(await withinGlobalDailyLimit())) {
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    console.error('[AI memory] validation failed:', JSON.stringify(parsed.error.issues));
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const conversationText = parsed.data.messages
    .map(m => `${m.role}: ${sanitizeAiInput(m.content)}`)
    .join('\n\n');

  try {
    const result = await generate({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: conversationText }],
      json: false,
      maxTokens: 1000,
      model: FACET_MODEL,
      abortMs: 50_000,
    });

    recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'extractMemory' }).catch(e =>
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

    memories = (Array.isArray(memories) ? memories : []).filter(m =>
      m && typeof m.text === 'string' && typeof m.kind === 'string' && VALID_KINDS.includes(m.kind),
    );

    return { memories };
  } catch (e) {
    console.error('[AI memory] failed:', e);
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new HttpsError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new HttpsError('internal', 'Memory extraction failed.');
  }
});
