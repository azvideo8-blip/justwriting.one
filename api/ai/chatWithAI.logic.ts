// functions/src/ai/chatWithAI.logic.ts
import { sanitizeAiInput, sanitizeAiResponse } from './pure';
import { validateInternalCallRestrictions, getMaxTokens, estimateInputTokens, assertNoSystemPromptInjection, acquireChatReservation } from '../../src/shared/ai/aiPolicy.js';
import { generate } from './provider';
import { buildChatSystemPrompt, assembleChatPromptParams, chatInputSchema, withReasoningLanguage } from '../../src/shared/ai/buildChatPrompt.js';
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
      customSystemPrompt,
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

  const maxTokens = getMaxTokens(isInternalCall, reasoning, parsed.data.callType);
  // AUD-19 & FU-4: вход тоже резервируется — см. api/chat.ts.
  // Составная квота: allowance = maxTokens + inputEstimate.
  const inputEstimate = estimateInputTokens([
    ...messages.map(m => m.content),
    documentContent, userPortrait, memoryContext, customSystemPrompt,
  ]);
  const reservation = await ctx.tryReserveGlobalRequest(maxTokens + inputEstimate);
  if (reservation && 'error' in reservation) {
    await callRes.settle('failed');
    throw new AiError('unavailable', 'Database temporarily unavailable.');
  }
  if (!reservation) {
    await callRes.settle('failed');
    throw new AiError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }
  callRes.attachGlobalReservation(reservation, inputEstimate);

  // DUP-2: Single shared prompt assembly
  const INTERNAL_SYSTEM_PROMPT = 'Ты — служебная функция приложения для дневника. Выполни ровно то, что просят, без пояснений.';
  const systemInstruction = isInternalCall
    ? (customSystemPrompt ? `${INTERNAL_SYSTEM_PROMPT}\n\n${customSystemPrompt}` : INTERNAL_SYSTEM_PROMPT)
    : buildChatSystemPrompt(assembleChatPromptParams(parsed.data));

  const providerMessages = messages.map(m => ({
    role: m.role,
    content: sanitizeAiInput(m.content),
  }));

  // Режим рассуждений — то же правило о языке, что в потоковом пути (api/chat.ts).
  const request = reasoning === true
    ? withReasoningLanguage(systemInstruction, providerMessages)
    : { system: systemInstruction, messages: providerMessages };

  let gen;
  try {
    gen = await generate({
      system: request.system,
      messages: request.messages,
      maxTokens,
      abortMs: 110_000,
      // Same effort as CHAT_REASONING_EFFORT in api/chat.ts (streaming path).
      reasoningEffort: reasoning === true ? 'low' : undefined,
    });
  } catch (e) {
    const { classifyProviderFailure } = await import('./pure');
    const failure = classifyProviderFailure(e);
    console.error(`[chatWithAI] AI request failed (${failure.reason}):`, e);
    await callRes.settle('failed');
    throw new AiError(failure.code, failure.reason);
  }

  const isReasoningMode = reasoning === true;
  // Same headers the streaming path writes, so the client parser is unchanged.
  const raw = isReasoningMode && gen.reasoning ? `ХОД МЫСЛИ:\n${gen.reasoning}\n\nОТВЕТ:\n${gen.text}` : gen.text;
  const text = sanitizeAiResponse(raw, isReasoningMode);

  callRes.markProduced(gen.text.length);
  await callRes.settle('done');

  ctx.recordUsage(uid, gen.tokensIn, gen.tokensOut, { model: gen.model, fn: 'chat' }, reservation).catch(e => console.error('[AI chat] usage record failed:', e));

  return { result: text };
}
