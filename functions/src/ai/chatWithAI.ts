import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, checkDailyLimit, refundDailyLimit, checkRateLimit, tryReserveGlobalRequest, refundGlobalRequest, INJECTION_PATTERNS, getLangfuse } from '../shared/aiUtils';
import { validateInternalCallRestrictions, getMaxTokens, type InternalCallType } from '../shared/aiPolicy';
import { generate, getActiveModel } from '../shared/aiProvider';
import { PRESET_PERSONA_IDS, type PersonaId } from '../shared/prompts';
import { buildChatSystemPrompt } from '../shared/buildChatPrompt';

const inputSchema = z.object({
  personaId: z.enum(['group_psychology', 'cbt', 'coach', 'editor', 'parts', 'custom']),
  customSystemPrompt: z.string().max(500).nullish(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(10_000),
  })).max(100).refine(msgs => {
    const totalChars = msgs.reduce((sum, m) => sum + m.content.length, 0);
    return totalChars <= 200_000;
  }, 'Total messages content exceeds 200K characters'),
  documentContent: z.string().max(50_000).nullish(),
  documentMood: z.string().max(50).nullish(),
  userPortrait: z.string().max(100_000).nullish(),
  responseLength: z.enum(['short', 'standard', 'detailed']).nullish(),
  reasoning: z.boolean().nullish(),
  callType: z.enum(['auto_name', 'follow_up', 'query_expand']).nullish() as z.ZodType<InternalCallType | null>,
});

export const chatWithAI = onCall({
  secrets: ['GEMINI_API_KEY', 'OPENROUTER_API_KEY'],
  timeoutSeconds: 120,
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const uid = request.auth.uid;

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    console.error('Validation failed for chatWithAI. Errors:', JSON.stringify(parsed.error.format()));
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { personaId, customSystemPrompt, messages, documentContent, documentMood, userPortrait, responseLength, reasoning } = parsed.data;

  // Internal call types: server-validated restrictions via centralized policy.
  // Per-user daily limit and cooldown are skipped; global guard still applies.
  let isInternalCall = false;
  try {
    const result = validateInternalCallRestrictions({
      callType: parsed.data.callType,
      personaId,
      reasoning,
      documentContent,
      userPortrait,
      messages,
    });
    isInternalCall = result.isInternal;
  } catch (e) {
    throw new HttpsError((e as { code: string }).code as 'invalid-argument', (e as Error).message);
  }

  if (personaId === 'custom') {
    if (!customSystemPrompt) {
      throw new HttpsError('invalid-argument', 'customSystemPrompt is required when personaId is "custom".');
    }
    if (INJECTION_PATTERNS.some(p => p.test(customSystemPrompt))) {
      throw new HttpsError('invalid-argument', 'Custom prompt failed security check.');
    }
  }

  // S-3: Injection guard for ALL message turns (not just user) — a client-fabricated
  // assistant message is the real injection vector.
  if (messages.some(m => INJECTION_PATTERNS.some(p => p.test(m.content)))) {
    throw new HttpsError('invalid-argument', 'Disallowed patterns detected in messages.');
  }

  // Per-user daily limit and cooldown — checked BEFORE reserving global slot
  // to avoid leaking a global slot on per-user rejection.
  if (!isInternalCall && !(await checkDailyLimit(uid, reasoning === true))) {
    throw new HttpsError('resource-exhausted', 'Daily limit reached.');
  }

  if (!isInternalCall && !(await checkRateLimit(uid))) {
    await refundDailyLimit(uid);
    throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a few seconds.');
  }

  // Project-wide free-tier guard — reserved only after all validation passes.
  if (!(await tryReserveGlobalRequest())) {
    if (!isInternalCall) await refundDailyLimit(uid);
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  // CHATFIX-6: Use shared buildChatSystemPrompt instead of inline copy
  const systemInstruction = buildChatSystemPrompt({
    personaId,
    customSystemPrompt: customSystemPrompt ? sanitizeAiInput(customSystemPrompt) : undefined,
    userPortrait: userPortrait ? sanitizeAiInput(userPortrait) : undefined,
    responseLength,
    reasoning,
    documentContent: documentContent ? sanitizeAiInput(documentContent) : undefined,
    documentMood: documentMood ? sanitizeAiInput(documentMood) : undefined,
  });

  // OPT-5: No more fake user/assistant turns — context is in system prompt
  const providerMessages = messages.map(m => ({
    role: m.role,
    content: sanitizeAiInput(m.content),
  }));

  const lf = getLangfuse();
  const activeModel = await getActiveModel();
  const trace = lf?.trace({ name: 'chatWithAI', userId: uid, metadata: { personaId } });
  const generation = trace?.generation({ name: activeModel, model: activeModel, input: providerMessages });

  let gen;
  try {
    const maxTokens = getMaxTokens(isInternalCall, reasoning);
    gen = await generate({ system: systemInstruction, messages: providerMessages, maxTokens, abortMs: 110_000 });
  } catch (e) {
    console.error('[chatWithAI] AI request failed:', e);
    if (!isInternalCall) await refundDailyLimit(uid);
    await refundGlobalRequest();
    generation?.end({ output: String(e), level: 'ERROR' });
    if (lf) await lf.flushAsync().catch(() => {});
    throw new HttpsError('internal', 'AI request failed.');
  }

  const isReasoningMode = reasoning === true;
  const text = sanitizeAiResponse(gen.text, isReasoningMode);

  generation?.end({ output: text, usage: { promptTokens: gen.tokensIn, completionTokens: gen.tokensOut } });
  recordUsage(uid, gen.tokensIn, gen.tokensOut, { model: gen.model, fn: 'chat' }).catch(e => console.error('[AI chat] usage record failed:', e));
  if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));

  return { result: text };
});
