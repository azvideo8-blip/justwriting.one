// functions/src/ai/deriveTaxonomy.logic.ts
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse } from './pure';
import { generate } from './provider';
import { AiError, type AiContext } from './context';
import { chargeCall, refundCall, parseCharge } from './policy';

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
  const callRes = await chargeCall(ctx, uid, charge);

  const digest = sanitizeAiInput(parsed.data.digest);
  console.warn(`[AI taxonomy] start: digest ${digest.length} chars`);

  const reservation = await ctx.tryReserveGlobalRequest(4096);
  if (!reservation) {
    await refundCall(ctx, callRes);
    console.error('[AI taxonomy] global daily cap reached');
    throw new AiError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  let settled = false;
  // Цикл ниже может сходить в модель дважды, а глобальная резервация одна.
  // Раньше recordUsage вызывался на каждой итерации с той же резервацией, и
  // токены повторной попытки записывались вторым вызовом по одному слоту.
  // Копим по попыткам и записываем ровно один раз в finally — тогда учёт
  // токенов совпадает с реально потраченным, а слот остаётся один.
  let tokensIn = 0, tokensOut = 0, usedModel = TAXO_MODEL;
  try {
    let domains: { label: string; seed: string }[] = [];
    let extraUserInstruction = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await generate({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Дайджест дневника:\n\n${digest}${extraUserInstruction}` }],
        json: true,
        maxTokens: 4096,
        abortMs: 110_000,
        model: TAXO_MODEL,
      });
      tokensIn += result.tokensIn;
      tokensOut += result.tokensOut;
      usedModel = result.model;
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
          break;
        } else if (attempt === 1) {
          console.warn('[AI taxonomy] English labels detected on attempt 1, re-requesting...');
          extraUserInstruction = '\n\nВАЖНО: Пожалуйста, переведи ВСЕ названия сфер (label) на русский язык. Названия сфер должны состоять только из русских слов.';
          continue;
        } else {
          const russianOnly = candidateDomains.filter(d => /[а-яё]/i.test(d.label));
          domains = russianOnly.length > 0 ? russianOnly : candidateDomains;
        }
      }
    }

    if (domains.length === 0) {
      console.warn('[AI taxonomy] No domains generated, returning empty domains array.');
      return { domains: [] };
    }

    return { domains };
  } catch (e) {
    if (!settled) {
      await refundCall(ctx, callRes);
      await ctx.refundGlobalRequest(reservation);
    }
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
