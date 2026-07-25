import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  sanitizeAiInput,
  sanitizeAiResponse,
  recordUsage,
  tryReserveGlobalRequest,
  refundGlobalRequest,
  checkAndIncrementBulkLimit,
  refundBulkLimit,
  hasInjectionAttempt,
} from '../shared/aiUtils';
import { generate } from '../shared/aiProvider';

const JUDGE_MODEL = process.env.AI_FACET_MODEL ?? 'deepseek/deepseek-v4-flash';

const inputSchema = z.object({
  belief: z.string().max(4_000),
  evidence: z.array(z.object({
    id: z.string().max(100),
    date: z.string().max(20),
    snippet: z.string().max(8_000).optional(),
  })).min(1).max(60),
});

const verdictSchema = z.object({
  passed: z.boolean(),
  reason: z.string().default(''),
  correctiveHint: z.string().default(''),
});

const SYSTEM_PROMPT = `Ты — придирчивый AI-Судья (Factchecker & Distortion Judge).
Твоя задача: проверить, является ли УБЕЖДЕНИЕ точным, неискаженным обобщением ФАКТОВ.

ОТМЕТЬ passed=false В СЛЕДУЮЩИХ СЛУЧАЯХ:
1. Потеряны важные условности или ограничения (например, в фактах "занимается медитацией иногда, но при сильном стрессе она раздражает", а в убеждении написали безоговорочное "всегда помогает медитация" — это искажение!).
2. Убеждение содержит додуманные события, числа или категоричные утверждения, не подтвержденные фактами.
3. Роли людей или ключевые термины искажены.

Если passed=false, обязательно опиши причину в reason и дай чёткую инструкцию в correctiveHint как исправить ошибку.

Верни СТРОГО валидный JSON:
{"passed": true|false, "reason": "краткая причина", "correctiveHint": "инструкция по исправлению если passed=false, иначе пустая строка"}
Только JSON, без markdown-тегов (без \`\`\`json) и рассуждений.`;

function repairTruncatedJson(raw: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const c of raw) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  let out = raw;
  if (inStr) {
    if (esc) out = out.slice(0, -1);
    out += '"';
  }
  out = out.replace(/,\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}

export const judgeBeliefCandidate = onCall({
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
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { belief, evidence } = parsed.data;

  // 1. Prompt Injection Checks BEFORE quota consumption
  if (hasInjectionAttempt(belief)) {
    throw new HttpsError('invalid-argument', 'Disallowed patterns in candidate belief.');
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
  const reservation = await tryReserveGlobalRequest(4096);
  if (!reservation) {
    await refundBulkLimit(uid);
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  let settled = false;
  try {
    const evidenceText = evidence
      .map((e, i) => `Фрагмент ${i + 1} [#${sanitizeAiInput(e.id)} · ${sanitizeAiInput(e.date)}]:\n${sanitizeAiInput(e.snippet ?? '')}`)
      .join('\n\n');

    const cleanBelief = sanitizeAiInput(belief);
    const userContent = `ПРОВЕРЯЕМОЕ УБЕЖДЕНИЕ:\n${cleanBelief}\n\nФАКТЫ ИЗ ПАМЯТИ:\n${evidenceText}`;

    const result = await generate({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      json: true,
      maxTokens: 4096,
      abortMs: 100_000,
      model: JUDGE_MODEL,
    });

    recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'judgeBeliefCandidate' }, reservation).catch(() => {});
    settled = true;

    let txt = result.text.trim();
    if (txt.startsWith('```')) {
      txt = txt.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    }

    let obj: unknown;
    try {
      obj = JSON.parse(txt);
    } catch {
      try {
        obj = JSON.parse(repairTruncatedJson(txt));
      } catch {
        obj = null;
      }
    }

    const valResult = verdictSchema.safeParse(obj);
    if (!valResult.success) {
      // SEC-25 strictness: unparseable output is treated as passed: false (fail-open to raw units)
      console.warn('[judgeBeliefCandidate] unparseable verdict (fail-open passed=false):', result.text.slice(0, 300));
      return {
        passed: false,
        reason: 'Unparseable judge verdict.',
        correctiveHint: '',
      };
    }

    const cleanReason = sanitizeAiResponse(valResult.data.reason);
    const cleanHint = sanitizeAiResponse(valResult.data.correctiveHint);

    return {
      passed: valResult.data.passed,
      reason: cleanReason,
      ...(cleanHint ? { correctiveHint: cleanHint } : {}),
    };
  } catch (e) {
    await refundBulkLimit(uid);
    if (!settled) await refundGlobalRequest(reservation);
    const msg = String((e as { message?: string })?.message ?? e);
    if (e instanceof HttpsError) throw e;
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new HttpsError('resource-exhausted', 'AI service temporarily unavailable.');
    }
    // Upstream errors / timeouts: soft failure (passed=false, fail-open to raw episodic units)
    console.warn('[judgeBeliefCandidate] soft failure (returning passed=false):', msg);
    return {
      passed: false,
      reason: 'Judge service error or timeout.',
      correctiveHint: '',
    };
  }
});
