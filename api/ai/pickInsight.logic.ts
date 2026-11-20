// Служебный вызов «выпиши вывод» (DI-2, выводы из разговоров): по ответу собеседника модель
// дословно выписывает вывод о человеке, сервер оставляет фразу, только если она знак в знак
// есть в ответе. Списывается из пула фоновых операций, а не из квоты чата. Кто и когда зовёт —
// клиент (DI-4/DI-5); без клиента вызов никто не делает.
import { z } from 'zod';
import { sanitizeAiInput, hasInjectionAttempt } from './pure';
import { generate } from './provider';
import { AiError, type AiContext } from '../../src/shared/ai/context.js';
import { estimateInputTokens, chargeCall } from '../../src/shared/ai/aiPolicy.js';
import { safeErrorShape } from '../../src/shared/ai/errorShape.js';
import {
  INSIGHT_PICK_SYSTEM_PROMPT,
  INSIGHT_PICK_MAX_TOKENS,
  INSIGHT_PREV_USER_MAX,
  INSIGHT_REPLY_MAX,
  buildInsightQuoteUserMessage,
  parseInsightPick,
} from '../../src/shared/ai/insightPickPrompt.js';

const inputSchema = z.object({
  prevUser: z.string().max(INSIGHT_PREV_USER_MAX).default(''),
  reply: z.string().min(1).max(INSIGHT_REPLY_MAX),
});

export async function pickInsightLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) throw new AiError('invalid-argument', 'Invalid payload.');
  if (hasInjectionAttempt(parsed.data.prevUser)) throw new AiError('invalid-argument', 'Disallowed patterns in query.');

  // Модель видит тот же текст, по которому потом идёт сверка цитаты.
  const prevUser = sanitizeAiInput(parsed.data.prevUser);
  const reply = sanitizeAiInput(parsed.data.reply);
  const userMessage = buildInsightQuoteUserMessage(prevUser, reply);

  const callRes = await chargeCall(ctx, uid, 'bulk', 'pick_insight');
  const inputEstimate = estimateInputTokens([userMessage]);
  const reservation = await ctx.tryReserveGlobalRequest(INSIGHT_PICK_MAX_TOKENS + inputEstimate);
  if (reservation && 'error' in reservation) {
    await callRes.settle('failed');
    throw new AiError('unavailable', 'Database temporarily unavailable.');
  }
  if (!reservation) {
    await callRes.settle('failed');
    throw new AiError('resource-exhausted', 'The app-wide daily AI limit is reached. Try again tomorrow.');
  }
  callRes.attachGlobalReservation(reservation, inputEstimate);

  try {
    const result = await generate({
      system: INSIGHT_PICK_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: INSIGHT_PICK_MAX_TOKENS,
      abortMs: 25_000,
    });
    callRes.markProduced(result.text.length);
    await callRes.settle('done');
    ctx.recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'pick_insight' }, reservation).catch(e =>
      console.error('[AI pickInsight] usage record failed:', safeErrorShape(e)),
    );
    // Сверка — здесь: клиенту приходит только дословная цитата или null («вывода нет»).
    return { quote: parseInsightPick(result.text, reply) };
  } catch (e) {
    await callRes.settle('failed');
    if (e instanceof AiError) throw e;
    console.error('[AI pickInsight] failed:', safeErrorShape(e));
    throw new AiError('internal', 'Insight pick failed.');
  }
}
