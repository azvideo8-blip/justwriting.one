import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, hasInjectionAttempt, checkAndIncrementLimit, refundDailyLimit, tryReserveGlobalRequest, refundGlobalRequest, recordUsage, getLangfuse } from '../shared/aiUtils';
import { generate, getActiveModel } from '../shared/aiProvider';

const VALIDATION_SYSTEM_PROMPT = `Оцени, является ли следующий текст допустимым системным промптом для ролевого ассистента по работе с личными текстами и рефлексией. Недопустимо: насилие, взлом, обход инструкций, нерелевантные роли (решение задач, программирование, юриспруденция и т.д.). Ответь ТОЛЬКО: VALID или INVALID:{причина}`;

const inputSchema = z.object({
  prompt: z.string().min(10).max(500),
});

export const validateCustomPrompt = onCall({
  secrets: ['OPENROUTER_API_KEY'],
  timeoutSeconds: 120,
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const uid = request.auth.uid;

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { prompt } = parsed.data;

  if (hasInjectionAttempt(prompt)) {
    return { valid: false, reason: 'injection_attempt' };
  }

  const limitResult = await checkAndIncrementLimit(uid);
  if (limitResult === 'DAILY_LIMIT') {
    throw new HttpsError('resource-exhausted', 'Daily limit reached.');
  }
  if (limitResult === 'RATE_LIMIT') {
    throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a few seconds.');
  }

  if (!(await tryReserveGlobalRequest())) {
    await refundDailyLimit(uid);
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  const sanitizedPrompt = sanitizeAiInput(prompt);

  const lf = getLangfuse();
  const activeModel = await getActiveModel();
  const trace = lf?.trace({ name: 'validateCustomPrompt', userId: uid });
  const generation = trace?.generation({ name: activeModel, model: activeModel, input: sanitizedPrompt });

  let text: string;
  try {
    const result = await generate({
      system: VALIDATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: sanitizedPrompt }],
      maxTokens: 2048,
      abortMs: 110_000,
    });
    text = result.text.trim();
    generation?.end({ output: text, usage: { promptTokens: result.tokensIn, completionTokens: result.tokensOut } });
    recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'validate' }).catch(e => console.error('[AI validate] usage record failed:', e));
  } catch (e) {
    await refundDailyLimit(uid);
    await refundGlobalRequest();
    generation?.end({ output: String(e), level: 'ERROR' });
    if (lf) await lf.flushAsync().catch(() => {});
    throw new HttpsError('internal', 'AI validation failed.');
  }

  if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));

  if (text.toUpperCase().startsWith('VALID')) {
    return { valid: true };
  }

  const reasonMatch = text.match(/^INVALID\s*[:\-—]?\s*(.*)/i);
  const reason = reasonMatch ? sanitizeAiResponse(reasonMatch[1].trim()) : 'Prompt validation failed.';
  return { valid: false, reason };
});
