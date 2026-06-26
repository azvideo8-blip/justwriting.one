import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, checkDailyLimit, refundDailyLimit, checkRateLimit, tryReserveGlobalRequest, refundGlobalRequest, INJECTION_PATTERNS, getLangfuse } from '../shared/aiUtils';
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
  callType: z.enum(['auto_name', 'follow_up', 'query_expand']).nullish(),
});

export const chatWithAI = onCall({
  secrets: ['GEMINI_API_KEY', 'FIREWORKS_API_KEY'],
  timeoutSeconds: 120,
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
    console.error('Validation failed for chatWithAI. Errors:', JSON.stringify(parsed.error.format()));
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { personaId, customSystemPrompt, messages, documentContent, documentMood, userPortrait, responseLength, reasoning, callType } = parsed.data;

  // Internal call types (auto-naming, follow-up generation, query expansion) skip
  // the per-user daily limit and cooldown — they are background infrastructure,
  // not user-initiated chat. The global guard (tryReserveGlobalRequest) still applies.
  // Internal calls are restricted: low maxTokens, no custom persona, no reasoning,
  // no document content, no user portrait — so there's no incentive to abuse this path.
  const isInternalCall = callType !== undefined && callType !== null;

  // Enforce restrictions on internal calls
  if (isInternalCall) {
    if (personaId === 'custom') {
      throw new HttpsError('invalid-argument', 'Custom persona not allowed for internal calls.');
    }
    if (reasoning === true) {
      throw new HttpsError('invalid-argument', 'Reasoning mode not allowed for internal calls.');
    }
    if (documentContent || userPortrait) {
      throw new HttpsError('invalid-argument', 'Document content and user portrait not allowed for internal calls.');
    }
    if (messages.length > 3) {
      throw new HttpsError('invalid-argument', 'Too many messages for internal call.');
    }
  }

  // LX-2a: Admins skip the per-user limit. Internal calls also skip.
  if (!isInternalCall && !(await checkDailyLimit(uid, reasoning === true))) {
    throw new HttpsError('resource-exhausted', 'Daily limit reached.');
  }

  if (!isInternalCall && !(await checkRateLimit(uid))) {
    await refundDailyLimit(uid);
    throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a few seconds.');
  }

  if (personaId === 'custom') {
    if (!customSystemPrompt) {
      throw new HttpsError('invalid-argument', 'customSystemPrompt is required when personaId is "custom".');
    }
    if (INJECTION_PATTERNS.some(p => p.test(customSystemPrompt))) {
      throw new HttpsError('invalid-argument', 'Custom prompt failed security check.');
    }
  }

  const userMessages = messages.filter(m => m.role === 'user');
  if (userMessages.some(m => INJECTION_PATTERNS.some(p => p.test(m.content)))) {
    throw new HttpsError('invalid-argument', 'Disallowed patterns detected in messages.');
  }

  // Injection guard for document content (RAG context injected into system prompt)
  if (documentContent && INJECTION_PATTERNS.some(p => p.test(documentContent))) {
    throw new HttpsError('invalid-argument', 'Disallowed patterns in document content.');
  }

  // CHATFIX-6: Use shared buildChatSystemPrompt instead of inline copy
  const systemInstruction = buildChatSystemPrompt({
    personaId,
    customSystemPrompt,
    userPortrait,
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
    const maxTokens = isInternalCall ? 256 : (reasoning ? 16384 : 8192);
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
