import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, tryReserveGlobalRequest, refundGlobalRequest, checkAndIncrementBulkLimit, refundBulkLimit } from '../shared/aiUtils';
import { generate } from '../shared/aiProvider';

const JUDGE_MODEL = process.env.AI_FACET_MODEL ?? 'deepseek/deepseek-v4-flash';

const inputSchema = z.object({
  facets: z.array(z.object({
    facetId: z.string().min(1).max(64),
    label: z.string().max(120),
    summary: z.string().max(4_000),
    evidence: z.string().max(8_000),
  })).min(1).max(20),
});

const SYSTEM_PROMPT = `Ты — придирчивый фактчекер. Для каждого фасета сверь его ОПИСАНИЕ с приведёнными ФАКТАМИ (роли людей, темы). Отметь ok=false ТОЛЬКО в двух случаях: (1) РОЛЬ упомянутого в описании человека ПРОТИВОРЕЧИТ его роли в фактах (например, описание: «коллега Лариса», факты: «Лариса — терапевт»); (2) описание содержит явно выдуманные события или числа, которых нет в фактах. ВАЖНО: если человек или деталь просто ОТСУТСТВУЕТ в фактах — это НЕ ошибка (факты могут быть неполными), НЕ флагай за это. К стилю и полноте НЕ придирайся. Верни СТРОГО валидный JSON:
{"verdicts":[{"facetId":"...","ok":true|false,"issues":["короткая претензия"],"hint":"инструкция как поправить — перечисли ВСЕ несоответствия ролей (Имя — правильная роль) и убери выдуманные факты"}]}
Если всё верно — ok=true, issues=[], hint="". Только JSON, без markdown и рассуждений.`;

function repairTruncatedJson(raw: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const c of raw) {
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  let out = raw;
  if (inStr) {
    if (esc) {
      out = out.slice(0, -1);
    }
    out += '"';
  }
  out = out.replace(/,\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}

const verdictSchema = z.object({
  facetId: z.string(),
  ok: z.boolean(),
  issues: z.array(z.string()).default([]),
  hint: z.string().default(''),
});

export const judgeFacets = onCall({
  secrets: ['OPENROUTER_API_KEY'],
  timeoutSeconds: 120,
  enforceAppCheck: true,
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Registration required.');
  const uid = request.auth.uid;

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');

  // Bulk daily limit check
  const allowed = await checkAndIncrementBulkLimit(uid);
  if (!allowed) {
    throw new HttpsError('resource-exhausted', 'Daily bulk operations limit reached.');
  }

  const facetsText = parsed.data.facets.map((f, i) =>
    `ФАСЕТ ${i + 1} [id=${sanitizeAiInput(f.facetId)}] «${sanitizeAiInput(f.label)}»\nОПИСАНИЕ: ${sanitizeAiInput(f.summary)}\nФАКТЫ: ${sanitizeAiInput(f.evidence)}`,
  ).join('\n\n');

  const reservation = await tryReserveGlobalRequest(8192);
  if (!reservation) {
    await refundBulkLimit(uid);
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  let settled = false;
  try {
    const result = await generate({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: facetsText }],
      json: true,
      maxTokens: 8192,
      abortMs: 100_000,
      model: JUDGE_MODEL,
    });
    recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'judge' }, reservation).catch(() => {});
    settled = true;

    let txt = result.text.trim();
    if (txt.startsWith('```')) txt = txt.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    let obj: unknown;
    try { obj = JSON.parse(txt); } catch { obj = JSON.parse(repairTruncatedJson(txt)); }

    const arr = z.object({ verdicts: z.array(verdictSchema) }).safeParse(obj);
    if (!arr.success) {
      console.error('[AI judge] no valid verdicts. raw:', result.text.slice(0, 400));
      throw new HttpsError('internal', 'Judge produced no verdicts.');
    }
    const verdicts = arr.data.verdicts.map(v => ({
      facetId: v.facetId,
      ok: v.ok,
      issues: v.issues.map(s => sanitizeAiResponse(s)),
      hint: sanitizeAiResponse(v.hint),
    }));
    return { verdicts };
  } catch (e) {
    await refundBulkLimit(uid);
    if (!settled) await refundGlobalRequest(reservation);
    const msg = String((e as { message?: string })?.message ?? e);
    if (!(e instanceof HttpsError)) console.error('[AI judge] failed:', msg);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new HttpsError('resource-exhausted', 'AI service temporarily unavailable.');
    }
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', 'Facet judging failed.');
  }
});
