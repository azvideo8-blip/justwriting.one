// DI-7: служебный вызов «о том же ли» — два параллельных вызова с одним телом,
// вывод вспоминается только если оба назвали один и тот же номер (сомнение —
// не вспоминать). Списывается из пула фоновых операций один раз, расход — одной
// записью match_insight на оба вызова.
import { z } from 'zod';
import { sanitizeAiInput, hasInjectionAttempt } from './pure';
import { generate } from './provider';
import { AiError, type AiContext } from '../../src/shared/ai/context.js';
import { estimateInputTokens, chargeCall } from '../../src/shared/ai/aiPolicy.js';
import { safeErrorShape } from '../../src/shared/ai/errorShape.js';
import {
  INSIGHT_MATCH_SYSTEM_PROMPT,
  INSIGHT_MATCH_MAX_TOKENS,
  buildInsightMatchUserMessage,
  parseInsightMatch,
} from '../../src/shared/ai/insightRecall.js';

const inputSchema = z.object({
  message: z.string().min(1).max(1_200),
  insights: z.array(z.object({
    text: z.string().max(400),
    context: z.string().max(400),
  })).min(1).max(12),
});

export async function matchInsightLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) throw new AiError('invalid-argument', 'Invalid payload.');
  if (hasInjectionAttempt(parsed.data.message)) throw new AiError('invalid-argument', 'Disallowed patterns in query.');

  const message = sanitizeAiInput(parsed.data.message);
  const insights = parsed.data.insights.map(i => ({ text: sanitizeAiInput(i.text), ctx: sanitizeAiInput(i.context) }));
  const userMessage = buildInsightMatchUserMessage(message, insights);

  const callRes = await chargeCall(ctx, uid, 'bulk', 'match_insight');
  const inputEstimate = estimateInputTokens([userMessage]);
  const reservation = await ctx.tryReserveGlobalRequest(INSIGHT_MATCH_MAX_TOKENS * 2 + inputEstimate);
  if (reservation && 'error' in reservation) {
    await callRes.settle('failed');
    throw new AiError('unavailable', 'Database temporarily unavailable.');
  }
  if (!reservation) {
    await callRes.settle('failed');
    throw new AiError('resource-exhausted', 'The app-wide daily AI limit is reached. Try again tomorrow.');
  }
  callRes.attachGlobalReservation(reservation, inputEstimate);

  const call = async () => {
    try {
      const result = await generate({
        system: INSIGHT_MATCH_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: INSIGHT_MATCH_MAX_TOKENS,
        abortMs: 20_000,
      });
      return { n: parseInsightMatch(result.text, insights.length), result };
    } catch (e) {
      console.error('[AI matchInsight] call failed:', safeErrorShape(e));
      return null;
    }
  };

  try {
    const [a, b] = await Promise.all([call(), call()]);
    // Резерв один на оба вызова — и расход записывается одной строкой (сумма
    // токенов), через защёлку callRes: две параллельные записи с одним резервом
    // сверяли его дважды, а settle('failed') добавлял третью (ревью 0.11.24, N-1).
    const ok = [a, b].filter((r): r is NonNullable<typeof r> => r !== null);
    if (ok.length > 0) {
      for (const r of ok) callRes.markProduced(r.result.text.length);
      const tokensIn = ok.reduce((n, r) => n + r.result.tokensIn, 0);
      const tokensOut = ok.reduce((n, r) => n + r.result.tokensOut, 0);
      callRes.recordUsage(tokensIn, tokensOut, { model: ok[0]!.result.model, fn: 'match_insight' }).catch(e =>
        console.error('[AI matchInsight] usage record failed:', safeErrorShape(e)),
      );
    }
    await callRes.settle(a && b ? 'done' : 'failed');
    // Номер — только если оба вызова назвали один и тот же; упавший вызов — 0.
    return { match: a && b && a.n >= 1 && a.n === b.n ? a.n : 0 };
  } catch (e) {
    await callRes.settle('failed');
    if (e instanceof AiError) throw e;
    console.error('[AI matchInsight] failed:', safeErrorShape(e));
    throw new AiError('internal', 'Insight match failed.');
  }
}