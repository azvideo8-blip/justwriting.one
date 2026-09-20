// functions/src/ai/chatWithAI.logic.ts
import { sanitizeAiInput, sanitizeAiResponse } from './pure';
import { validateInternalCallRestrictions, getMaxTokens, estimateInputTokens, assertNoSystemPromptInjection, acquireChatReservation } from '../../src/shared/ai/aiPolicy.js';
import { generate } from './provider';
import { buildChatSystemPrompt, assembleChatPromptParams, chatInputSchema } from '../../src/shared/ai/buildChatPrompt.js';
import { AiError, type AiContext } from '../../src/shared/ai/context.js';

const inputSchema = chatInputSchema;

export async function chatWithAILogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) {
    console.error('Validation failed for chatWithAI. Errors:', JSON.stringify(parsed.error.format()));
    throw new AiError('invalid-argument', 'Invalid payload.');
  }

  const { personaId, customSystemPrompt, messages, documentContent, userPortrait, memoryContext, reasoning } = parsed.data;

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

  // AUDIT-MH8: Note-derived context (documentContent, memoryContext, userPortrait,
  // documentMood) is fenced and sanitized via buildChatSystemPrompt — matching
  // an injection heuristic in user's diary notes must not self-DoS chat.
  // Only direct instructions (messages, customSystemPrompt) are hard-rejected.
  assertNoSystemPromptInjection({
    messages,
    customSystemPrompt,
    personaId,
  });

  // DUP-1: Unified reservation lifetime
  const callRes = await acquireChatReservation(ctx, uid, isInternalCall, reasoning === true);

  const maxTokens = getMaxTokens(isInternalCall, reasoning);
  // AUD-19 & FU-4: вход тоже резервируется — см. api/chat.ts.
  // Составная квота: allowance = maxTokens + inputEstimate.
  const inputEstimate = estimateInputTokens([
    ...messages.map(m => m.content),
    documentContent, userPortrait, memoryContext, customSystemPrompt,
  ]);
  const reservation = await ctx.tryReserveGlobalRequest(maxTokens + inputEstimate);
  if (!reservation) {
    await callRes.settle('failed');
    throw new AiError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }
  callRes.attachGlobalReservation(reservation, inputEstimate);

  // DUP-2: Single shared prompt assembly
  const systemInstruction = buildChatSystemPrompt(assembleChatPromptParams(parsed.data));

  const providerMessages = messages.map(m => ({
    role: m.role,
    content: sanitizeAiInput(m.content),
  }));

  let gen;
  try {
    gen = await generate({ system: systemInstruction, messages: providerMessages, maxTokens, abortMs: 110_000 });
  } catch (e) {
    const { classifyProviderFailure } = await import('./pure');
    const failure = classifyProviderFailure(e);
    console.error(`[chatWithAI] AI request failed (${failure.reason}):`, e);
    await callRes.settle('failed');
    throw new AiError(failure.code, failure.reason);
  }

  const isReasoningMode = reasoning === true;
  const text = sanitizeAiResponse(gen.text, isReasoningMode);

  callRes.markProduced(gen.text.length);
  await callRes.settle('done');

  ctx.recordUsage(uid, gen.tokensIn, gen.tokensOut, { model: gen.model, fn: 'chat' }, reservation).catch(e => console.error('[AI chat] usage record failed:', e));

  return { result: text };
}
