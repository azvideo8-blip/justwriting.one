// functions/src/ai/summarizeFacet.logic.ts
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, hasInjectionAttempt } from './pure';
import { generate } from './provider';
import { AiError, type AiContext } from '../../src/shared/ai/context.js';
import { chargeCall, parseCharge } from '../../src/shared/ai/aiPolicy.js';

const FACET_MODEL = process.env.AI_FACET_MODEL ?? 'deepseek/deepseek-v4-flash';

const inputSchema = z.object({
  notes: z.array(z.object({
    title: z.string().max(300),
    excerpt: z.string().max(8_000),
  })).min(1).max(60),
  focus: z.string().max(200).nullish().default(null),
  correction: z.string().max(500).nullish().default(null),
});

const SYSTEM_PROMPT = 'Ты анализируешь группу фрагментов из личных заметок пользователя на одну тему. Ответь СТРОГО на русском, обернув результат в XML-теги:\n<label>короткое название темы, 1–4 слова</label>\n<description>5–8 предложений от третьего лица: о чём пользователь пишет в этой теме, какие повторяющиеся ситуации, чувства и внутренние конфликты, как меняется отношение со временем.</description>\nЖЁСТКИЕ ПРАВИЛА (точность важнее красоты и подробности):\n— Опирайся ТОЛЬКО на приведённые фрагменты. Не добавляй ничего, чего в них нет: ни фактов, ни чисел, ни названий продуктов, ни событий.\n— Имена людей бери из текста БУКВАЛЬНО. Если имя не написано или ты не уверен в нём — пиши роль («партнёр», «жена», «дочь», «клиент», «родители»), НЕ выдумывай и НЕ искажай имена.\n— Если деталь не подтверждена текстом — обобщай, а не додумывай. Лучше общая верная фраза, чем выдуманная конкретика.\n— Если про тему во фрагментах почти ничего нет — напиши одно честное предложение об этом.\nНЕ рассуждай вслух, не описывай задачу, не пиши «мы имеем заметки» — сразу результат.';

export async function summarizeFacetLogic(ctx: AiContext, uid: string, data: unknown): Promise<unknown> {
  const parsed = inputSchema.safeParse(data);
  if (!parsed.success) {
    console.error('[AI facet] validation failed:', parsed.error.issues.map(i => `${i.path.join('.')}:${i.code}`).join(', '));
    throw new AiError('invalid-argument', 'Invalid payload.');
  }

  const notesText = parsed.data.notes
    .map((n, i) => `Заметка ${i + 1} «${sanitizeAiInput(n.title)}»:\n${sanitizeAiInput(n.excerpt)}`)
    .join('\n\n');

  if (hasInjectionAttempt(notesText)) {
    throw new AiError('invalid-argument', 'Disallowed patterns in notes.');
  }

  if (parsed.data.correction && hasInjectionAttempt(parsed.data.correction)) {
    throw new AiError('invalid-argument', 'Disallowed patterns in correction.');
  }

  if (parsed.data.focus && hasInjectionAttempt(parsed.data.focus)) {
    throw new AiError('invalid-argument', 'Disallowed patterns in focus.');
  }

  // Обновление профиля помечает свои вызовы `charge: 'user'` и платит из
  // дневного лимита человека; всё остальное — из фонового, как раньше.
  const charge = parseCharge((data as { charge?: unknown } | null)?.charge);
  const callRes = await chargeCall(ctx, uid, charge, 'summarizeFacet');

  const focus = parsed.data.focus ? sanitizeAiInput(parsed.data.focus) : '';
  const system = focus
    ? `${SYSTEM_PROMPT} Опиши ТОЛЬКО то, что относится к теме «${focus}»; игнорируй формат дневника и всё постороннее. Если про эту тему почти ничего нет — одно предложение об этом.`
    : SYSTEM_PROMPT;

  const correction = parsed.data.correction ? sanitizeAiInput(parsed.data.correction) : '';
  const systemWithCorrection = correction
    ? `${system}\nДополнительный контекст: ${correction}`
    : system;

  const reservation = await ctx.tryReserveGlobalRequest(2048);
  if (!reservation) {
    await callRes.settle('failed');
    throw new AiError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }
  callRes.attachGlobalReservation(reservation);

  try {
    const result = await generate({
      system: systemWithCorrection,
      messages: [{ role: 'user', content: `Фрагменты заметок${focus ? ` (тема «${focus}»)` : ''}:\n\n${notesText}` }],
      json: false,
      maxTokens: 2048,
      model: FACET_MODEL,
      abortMs: 110_000,
    });

    callRes.markProduced(result.text.length);

    callRes.recordUsage(result.tokensIn, result.tokensOut, { model: result.model, fn: 'facet' }).catch(e =>
      console.error('[AI facet] usage record failed:', e),
    );

    const text = result.text.trim();
    const META = /мы (имеем|должны)|нужно (определить|проанализ)|проанализир|(?<=^|[^а-яёА-ЯЁa-zA-Z0-9])we need(?=$|[^а-яёА-ЯЁa-zA-Z0-9])|the (user|notes|theme)|given notes|<think>|похоже,?\s*что|возможно,?\s*(это|жен)|в заметке\s*\d|из заметок|предложени[яй] от третьего/i;
    const cyr = (s: string) => (s.match(/[а-яё]/gi) ?? []).length;

    let label = (text.match(/<label>([\s\S]*?)<\/label>/i)?.[1] ?? '').trim().replace(/[«»"]/g, '');
    if (!label) label = (text.match(/НАЗВАНИЕ\s*:\s*(.+)/i)?.[1] ?? '').trim().replace(/[«»"]/g, '');

    let summary = (text.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? '').trim();
    if (!summary) {
      summary = text.split(/ОПИСАНИЕ\s*:|опиш[уи]\s*:/i).pop()?.trim() ?? '';
      summary = summary.replace(/\n+НАЗВАНИЕ\s*:[\s\S]*$/i, '').trim();
    }
    if (!summary && text.includes('<description>')) {
      summary = text.slice(text.indexOf('<description>') + '<description>'.length).trim();
    }

    let finalLabel = label;
    const truncated = summary.length > 0 && !/[.!?]$/.test(summary);
    if (!summary || META.test(summary) || cyr(summary) < summary.length * 0.3 || (truncated && summary.length < 200)) {
      await callRes.settle('failed');
      finalLabel = '';
      summary = '';
    } else {
      await callRes.settle('done');
    }
    if (finalLabel && (META.test(finalLabel) || cyr(finalLabel) === 0)) finalLabel = '';
    if (!finalLabel && summary) {
      finalLabel = summary.split(/[.!?\n]/)[0]!.split(/\s+/).slice(0, 5).join(' ').slice(0, 48);
    }

    const cleanLabel = sanitizeAiResponse(finalLabel);
    const cleanSummary = sanitizeAiResponse(summary);
    return { label: cleanLabel, summary: cleanSummary };
  } catch (e) {
    await callRes.settle('failed');
    console.error('[AI facet] failed:', e);
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new AiError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new AiError('internal', 'Facet summarization failed.');
  }
}
