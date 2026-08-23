// functions/src/ai/chatWithAI.logic.ts
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, hasInjectionAttempt, getLangfuse, hashUid, MAX_AI_CONTENT_LENGTH } from './pure';
import { validateInternalCallRestrictions, getMaxTokens, type InternalCallType } from '../../src/shared/ai/aiPolicy.js';
import { generate, getActiveModel } from './provider';
import { buildChatSystemPrompt } from '../../src/shared/ai/buildChatPrompt.js';
import { AiError, type AiContext } from '../../src/shared/ai/context.js';

const inputSchema = z.object({
  personaId: z.enum(['group_psychology', 'cbt', 'coach', 'editor', 'parts', 'custom']),
  customSystemPrompt: z.string().max(500).nullish(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(MAX_AI_CONTENT_LENGTH),
  })).max(100).refine(msgs => {
    const totalChars = msgs.reduce((sum, m) => sum + m.content.length, 0);
    return totalChars <= 200_000;
  }, 'Total messages content exceeds 200K characters'),
  documentContent: z.string().max(MAX_AI_CONTENT_LENGTH).nullish(),
  documentMood: z.string().max(50).nullish(),
  userPortrait: z.string().max(10_000).nullish(),
  responseLength: z.enum(['short', 'standard', 'detailed']).nullish(),
  reasoning: z.boolean().nullish(),
  callType: z.enum(['auto_name', 'follow_up', 'query_expand']).nullish() as z.ZodType<InternalCallType | null>,
});

export async function chatWithAILogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) {
    console.error('Validation failed for chatWithAI. Errors:', JSON.stringify(parsed.error.format()));
    throw new AiError('invalid-argument', 'Invalid payload.');
  }

  const { personaId, customSystemPrompt, messages, documentContent, documentMood, userPortrait, responseLength, reasoning } = parsed.data;

  let isInternalCall = false;
  try {
    const result = validateInternalCallRestrictions({
      callType: parsed.data.callType,
      personaId,
      reasoning: reasoning ?? undefined,
      documentContent: documentContent ?? undefined,
      userPortrait: userPortrait ?? undefined,
      messages,
    });
    isInternalCall = result.isInternal;
  } catch (e) {
    throw new AiError((e as { code: string }).code, (e as Error).message);
  }

  if (personaId === 'custom') {
    if (!customSystemPrompt) {
      throw new AiError('invalid-argument', 'customSystemPrompt is required when personaId is "custom".');
    }
    if (hasInjectionAttempt(customSystemPrompt)) {
      throw new AiError('invalid-argument', 'Custom prompt failed security check.');
    }
  }

  if (messages.some(m => hasInjectionAttempt(m.content))) {
    throw new AiError('invalid-argument', 'Disallowed patterns detected in messages.');
  }

  if (documentContent && hasInjectionAttempt(documentContent)) {
    throw new AiError('invalid-argument', 'Disallowed patterns detected in document content.');
  }

  if (userPortrait && hasInjectionAttempt(userPortrait)) {
    throw new AiError('invalid-argument', 'Disallowed patterns detected in user portrait.');
  }

  if (documentMood && hasInjectionAttempt(documentMood)) {
    throw new AiError('invalid-argument', 'Disallowed patterns detected in document mood.');
  }

  // Внутренний вызов не бесплатный: у него свой счётчик. Раньше `callType`
  // с клиента снимал и дневной лимит, и задержку между запросами — один
  // пользователь мог в цикле выжечь общий суточный лимит приложения. Тот же
  // порядок, что в api/chat.ts: внутренние идут в bulk-счётчик, обычные — в
  // обычный. День списания едет в refund'ы ниже.
  let chargedDay: string | undefined;
  if (isInternalCall) {
    const verdict = await ctx.checkAndIncrementBulkLimit(uid);
    if (!verdict.ok) {
      throw new AiError('resource-exhausted', 'Daily limit reached.');
    }
    chargedDay = verdict.day;
  } else {
    const limitResult = await ctx.checkAndIncrementLimit(uid, reasoning === true);
    if (limitResult === 'DAILY_LIMIT') {
      throw new AiError('resource-exhausted', 'Daily limit reached.');
    }
    if (limitResult === 'RATE_LIMIT') {
      throw new AiError('resource-exhausted', 'Too many requests. Please wait a few seconds.');
    }
    chargedDay = limitResult.day;
  }

  const maxTokens = getMaxTokens(isInternalCall, reasoning);
  const reservation = await ctx.tryReserveGlobalRequest(maxTokens);
  if (!reservation) {
    if (isInternalCall) await ctx.refundBulkLimit(uid, chargedDay);
    else await ctx.refundDailyLimit(uid, chargedDay);
    throw new AiError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  const systemInstruction = buildChatSystemPrompt({
    personaId,
    customSystemPrompt: customSystemPrompt ? sanitizeAiInput(customSystemPrompt) : undefined,
    userPortrait: userPortrait ? sanitizeAiInput(userPortrait) : undefined,
    responseLength,
    reasoning,
    documentContent: documentContent ? sanitizeAiInput(documentContent) : undefined,
    documentMood: documentMood ? sanitizeAiInput(documentMood) : undefined,
  });

  const providerMessages = messages.map(m => ({
    role: m.role,
    content: sanitizeAiInput(m.content),
  }));

  const lf = getLangfuse();
  const activeModel = await getActiveModel();
  const trace = lf?.trace({ name: 'chatWithAI', userId: hashUid(uid), metadata: { personaId, messageCount: providerMessages.length } });
  const generation = trace?.generation({ name: activeModel, model: activeModel });

  let gen;
  try {
    gen = await generate({ system: systemInstruction, messages: providerMessages, maxTokens, abortMs: 110_000 });
  } catch (e) {
    const { classifyProviderFailure } = await import('./pure');
    const failure = classifyProviderFailure(e);
    console.error(`[chatWithAI] AI request failed (${failure.reason}):`, e);
    if (isInternalCall) await ctx.refundBulkLimit(uid, chargedDay);
    else await ctx.refundDailyLimit(uid, chargedDay);
    await ctx.refundGlobalRequest(reservation);
    generation?.end({ level: 'ERROR' });
    if (lf) await lf.flushAsync().catch(() => {});
    throw new AiError(failure.code, failure.reason);
  }

  const isReasoningMode = reasoning === true;
  const text = sanitizeAiResponse(gen.text, isReasoningMode);

  generation?.end({ usage: { promptTokens: gen.tokensIn, completionTokens: gen.tokensOut } });
  ctx.recordUsage(uid, gen.tokensIn, gen.tokensOut, { model: gen.model, fn: 'chat' }, reservation).catch(e => console.error('[AI chat] usage record failed:', e));
  if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));

  return { result: text };
}
