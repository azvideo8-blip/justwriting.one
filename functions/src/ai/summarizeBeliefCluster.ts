import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  sanitizeAiInput,
  sanitizeAiResponse,
  recordUsage,
  tryReserveGlobalRequest,
  refundGlobalRequest,
  hasInjectionAttempt,
  checkAndIncrementBulkLimit,
  refundBulkLimit,
} from '../shared/aiUtils';
import { generate } from '../shared/aiProvider';

const BELIEF_MODEL = process.env.AI_FACET_MODEL ?? 'deepseek/deepseek-v4-flash';

const inputSchema = z.object({
  evidence: z.array(z.object({
    id: z.string().max(100),
    date: z.string().max(20),
    snippet: z.string().max(8_000).optional(),
  })).min(1).max(60),
  firstSeenAt: z.string().max(50),
  correctionHint: z.string().max(1_000).nullish().default(null),
});

const SYSTEM_PROMPT = `Ты анализируешь группу связанных фрагментов из личной памяти и заметок пользователя.
Твоя задача: сформулировать ОДНО устойчивое смысловое убеждение пользователя (semantic belief) на русском языке.

ЖЁСТКИЕ ПРАВИЛА:
1. Сохраняй ВСЕ условности, ограничения и противоположные стороны ("иногда", "но при Х происходит Y"). Не превращай условные утверждения в категоричные (например, "X иногда, но Y" КАТЕГОРИЧЕСКИ НЕ ДОЛЖНО превращаться в "пользователь считает X").
2. Учитывай дату первого появления мысли (firstSeenAt).
3. Пиши точно, емко и без домыслов (1–2 предложения).
4. Опирайся ТОЛЬКО на предоставленные факты. Не добавляй ничего лишнего.
Сразу выдавай итоговое убеждение, без вводных фраз ("мы видим", "пользователь думает, что") и без мета-комментариев.`;

export const summarizeBeliefCluster = onCall({
  secrets: ['OPENROUTER_API_KEY'],
  timeoutSeconds: 120,
  enforceAppCheck: true,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }
  const uid = request.auth.uid;

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    console.error('[summarizeBeliefCluster] validation failed:', JSON.stringify(parsed.error.issues));
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { evidence, firstSeenAt, correctionHint } = parsed.data;

  // 1. Prompt Injection Checks BEFORE quota consumption
  if (hasInjectionAttempt(firstSeenAt)) {
    throw new HttpsError('invalid-argument', 'Disallowed patterns in firstSeenAt.');
  }

  if (correctionHint && hasInjectionAttempt(correctionHint)) {
    throw new HttpsError('invalid-argument', 'Disallowed patterns in correctionHint.');
  }

  for (const item of evidence) {
    if (item.snippet && hasInjectionAttempt(item.snippet)) {
      throw new HttpsError('invalid-argument', 'Disallowed patterns in evidence snippet.');
    }
  }

  // 2. Bulk daily limit check
  const allowed = await checkAndIncrementBulkLimit(uid);
  if (!allowed) {
    throw new HttpsError('resource-exhausted', 'Daily bulk operations limit reached.');
  }

  // 3. Global Budget Reservation
  const reservation = await tryReserveGlobalRequest(2048);
  if (!reservation) {
    await refundBulkLimit(uid);
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  try {
    const evidenceText = evidence
      .map((e, i) => `Фрагмент ${i + 1} [#${sanitizeAiInput(e.id)} · ${sanitizeAiInput(e.date)}]:\n${sanitizeAiInput(e.snippet ?? '')}`)
      .join('\n\n');

    const cleanFirstSeen = sanitizeAiInput(firstSeenAt);
    const cleanCorrection = correctionHint ? sanitizeAiInput(correctionHint) : '';

    const systemWithContext = cleanCorrection
      ? `${SYSTEM_PROMPT}\n\nВНИМАНИЕ (исправление ошибок прошлых попыток): ${cleanCorrection}`
      : SYSTEM_PROMPT;

    const userContent = `Первое упоминание от: ${cleanFirstSeen}\n\nФакты из памяти:\n${evidenceText}`;

    const result = await generate({
      system: systemWithContext,
      messages: [{ role: 'user', content: userContent }],
      json: false,
      maxTokens: 2048,
      model: BELIEF_MODEL,
      abortMs: 110_000,
    });

    recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'summarizeBeliefCluster' }, reservation).catch(e =>
      console.error('[summarizeBeliefCluster] usage record failed:', e)
    );

    const cleanBelief = sanitizeAiResponse(result.text.trim());
    return { belief: cleanBelief };
  } catch (e) {
    await refundBulkLimit(uid);
    await refundGlobalRequest(reservation);
    console.error('[summarizeBeliefCluster] failed:', e);
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new HttpsError('resource-exhausted', 'AI service is temporarily unavailable.');
    }
    throw new HttpsError('internal', 'Belief cluster summarization failed.');
  }
});
