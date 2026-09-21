// functions/src/ai/deriveTaxonomy.logic.ts
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse } from './pure';
import { generate } from './provider';
import { AiError, type AiContext } from '../../src/shared/ai/context.js';
import { chargeCall, parseCharge } from '../../src/shared/ai/aiPolicy.js';

const inputSchema = z.object({ digest: z.string().min(20).max(60_000) });

const TAXO_MODEL = process.env.AI_FACET_MODEL ?? 'deepseek/deepseek-v4-flash';

const SYSTEM_PROMPT = `Ты получаешь дайджест тем, инсайтов и людей из личного дневника одного человека. Определи 6–10 ОСНОВНЫХ жизненных сфер (доменов), вокруг которых вращается этот дневник — так, как они есть у ЭТОГО человека, а не общими категориями. Верни СТРОГО валидный JSON:
{"domains":[{"label":"короткое название сферы, 1–3 слова","seed":"1–2 предложения, богато описывающие эту сферу словами из дайджеста — для семантического поиска"}]}
ЖЁСТКИЕ ПРАВИЛА: label И seed — СТРОГО на русском языке (никакого английского в названиях); опирайся ТОЛЬКО на дайджест; не выдумывай сфер, которых в нём нет; имена и факты бери из дайджеста буквально; 6–10 доменов, не больше; только JSON, без markdown и рассуждений.`;

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
  if (inStr) { if (esc) { out = out.slice(0, -1); } out += '"'; }
  out = out.replace(/,\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}

const domainSchema = z.object({ label: z.string().min(1).max(60), seed: z.string().min(3).max(600) });

export async function deriveTaxonomyLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) throw new AiError('invalid-argument', 'Invalid payload.');

  // Обновление профиля помечает свои вызовы `charge: 'user'` и платит из
  // дневного лимита человека; всё остальное — из фонового, как раньше.
  const charge = parseCharge((data as { charge?: unknown } | null)?.charge);
  const callRes = await chargeCall(ctx, uid, charge, 'taxonomy');

  const digest = sanitizeAiInput(parsed.data.digest);
  console.warn(`[AI taxonomy] start: digest ${digest.length} chars`);

  const reservation = await ctx.tryReserveGlobalRequest(4096);
  if (reservation && 'error' in reservation) {
    await callRes.settle('failed');
    throw new AiError('unavailable', 'Database temporarily unavailable.');
  }
  if (!reservation) {
    await callRes.settle('failed');
    console.error('[AI taxonomy] global daily cap reached');
    throw new AiError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }
  callRes.attachGlobalReservation(reservation);

  let settled = false;
  // Цикл ниже может сходить в модель дважды, а глобальная резервация одна.
  // Раньше recordUsage вызывался на каждой итерации с той же резервацией, и
  // токены повторной попытки записывались вторым вызовом по одному слоту.
  // Копим по попыткам и записываем ровно один раз в finally — тогда учёт
  // токенов совпадает с реально потраченным, а слот остаётся один.
  let tokensIn = 0, tokensOut = 0, usedModel = TAXO_MODEL;
  try {
    let domains: { label: string; seed: string }[] = [];

    const result = await generate({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Дайджест дневника:\n\n${digest}` }],
      json: true,
      maxTokens: 4096,
      abortMs: 110_000,
      model: TAXO_MODEL,
    });
    tokensIn += result.tokensIn;
    tokensOut += result.tokensOut;
    usedModel = result.model;
    callRes.markProduced(result.text.length);
    // Токены уже потрачены: возвращать резервацию нельзя, даже если дальше упадём.
    settled = true;

    let txt = result.text.trim();
    if (txt.startsWith('```')) txt = txt.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    let obj: unknown;
    try { obj = JSON.parse(txt); } catch { obj = JSON.parse(repairTruncatedJson(txt)); }

    const arr = z.object({ domains: z.array(domainSchema) }).safeParse(obj);
    if (arr.success && arr.data.domains.length > 0) {
      const candidateDomains = arr.data.domains.slice(0, 10).map(d => ({
        label: sanitizeAiResponse(d.label),
        seed: sanitizeAiResponse(d.seed),
      })).filter(d => d.label.length > 0 && d.seed.length > 0);

      const hasEnglishOnlyLabel = candidateDomains.some(d => !/[а-яё]/i.test(d.label));
      if (!hasEnglishOnlyLabel) {
        domains = candidateDomains;
      } else {
        console.warn('[AI taxonomy] English labels detected, requesting label translation only...');
        try {
          const transResult = await generate({
            system: 'Ты — переводчик. Переведи список названий жизненных сфер на русский язык. Верни ТОЛЬКО валидный JSON вида {"labels":["Сфера 1","Сфера 2"]}.',
            messages: [{
              role: 'user',
              content: `Переведи названия сфер на русский:\n${JSON.stringify(candidateDomains.map(d => d.label))}`,
            }],
            json: true,
            maxTokens: 512,
            abortMs: 30_000,
            model: TAXO_MODEL,
          });
          tokensIn += transResult.tokensIn;
          tokensOut += transResult.tokensOut;
          callRes.markProduced(transResult.text.length);

          let transTxt = transResult.text.trim();
          if (transTxt.startsWith('```')) transTxt = transTxt.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
          const transObj = JSON.parse(transTxt) as { labels?: string[] };
          if (Array.isArray(transObj.labels) && transObj.labels.length === candidateDomains.length) {
            domains = candidateDomains.map((d, i) => ({
              label: sanitizeAiResponse(transObj.labels![i] || d.label),
              seed: d.seed,
            }));
          }
        } catch (transErr) {
          console.warn('[AI taxonomy] label translation failed, falling back:', transErr);
        }

        if (domains.length === 0) {
          const russianOnly = candidateDomains.filter(d => /[а-яё]/i.test(d.label));
          domains = russianOnly.length > 0 ? russianOnly : candidateDomains;
        }
      }
    }

    await callRes.settle('done');

    if (domains.length === 0) {
      console.warn('[AI taxonomy] No domains generated, returning empty domains array.');
      return { domains: [] };
    }

    return { domains };
  } catch (e) {
    await callRes.settle('failed');
    const msg = String((e as { message?: string })?.message ?? e);
    if (!(e instanceof AiError)) console.error('[AI taxonomy] failed:', msg);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new AiError('resource-exhausted', 'AI service temporarily unavailable.');
    }
    if (e instanceof AiError) throw e;
    throw new AiError('internal', 'Taxonomy derivation failed.');
  } finally {
    if (settled) {
      ctx.recordUsage(uid, tokensIn, tokensOut, { model: usedModel, fn: 'taxonomy' }, reservation).catch(() => {});
    }
  }
}
