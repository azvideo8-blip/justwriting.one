// functions/src/ai/judgeBeliefCandidate.logic.ts
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, hasInjectionAttempt } from './pure';
import { generate } from './provider';
import { AiError, type AiContext } from '../../src/shared/ai/context.js';
import { chargeCall, refundCall, parseCharge } from '../../src/shared/ai/aiPolicy.js';

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

export async function judgeBeliefCandidateLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) {
    throw new AiError('invalid-argument', 'Invalid payload.');
  }

  const { belief, evidence } = parsed.data;

  if (hasInjectionAttempt(belief)) {
    throw new AiError('invalid-argument', 'Disallowed patterns in candidate belief.');
  }

  for (const item of evidence) {
    if (item.snippet && hasInjectionAttempt(item.snippet)) {
      throw new AiError('invalid-argument', 'Disallowed patterns in evidence snippet.');
    }
  }

  // Обновление профиля помечает свои вызовы `charge: 'user'` и платит из
  // дневного лимита человека; всё остальное — из фонового, как раньше.
  const charge = parseCharge((data as { charge?: unknown } | null)?.charge);
  const callRes = await chargeCall(ctx, uid, charge);

  const reservation = await ctx.tryReserveGlobalRequest(4096);
  if (!reservation) {
    await refundCall(ctx, callRes);
    throw new AiError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
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

    ctx.recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'judgeBeliefCandidate' }, reservation).catch(() => {});
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
      // В журнал сервера — форма ответа, а не его содержимое: текст выведен из
      // заметок человека, а журнал не шифруется и не проходит через PII-фильтр.
      console.warn('[judgeBeliefCandidate] unparseable verdict (fail-open passed=false):', { length: result.text.length });
      return { passed: false, reason: 'Unparseable judge verdict.', correctiveHint: '' };
    }

    const cleanReason = sanitizeAiResponse(valResult.data.reason);
    const cleanHint = sanitizeAiResponse(valResult.data.correctiveHint);

    return {
      passed: valResult.data.passed,
      reason: cleanReason,
      ...(cleanHint ? { correctiveHint: cleanHint } : {}),
    };
  } catch (e) {
    if (!settled) {
      await refundCall(ctx, callRes);
      await ctx.refundGlobalRequest(reservation);
    }
    const msg = String((e as { message?: string })?.message ?? e);
    if (e instanceof AiError) throw e;
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new AiError('resource-exhausted', 'AI service temporarily unavailable.');
    }
    console.warn('[judgeBeliefCandidate] soft failure (returning passed=false):', msg);
    return { passed: false, reason: 'Judge service error or timeout.', correctiveHint: '' };
  }
}
