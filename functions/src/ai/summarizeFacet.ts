import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, tryReserveGlobalRequest, refundGlobalRequest } from '../shared/aiUtils';
import { generate } from '../shared/aiProvider';

// Summarizes one cluster of the user's notes into a profile facet (label +
// description). Like embed/rerank this is profile infrastructure — exempt from
// the per-user chat limits, guarded only by the project-wide cost cap.

const inputSchema = z.object({
  notes: z.array(z.object({
    title: z.string().max(300),
    excerpt: z.string().max(8_000),
  })).min(1).max(60),
  focus: z.string().max(200).nullish().default(null),
});

// DeepSeek (the default chat model) is a reasoning model that leaks its
// chain-of-thought into the answer for this task. Use an obedient model for
// facet summaries instead. Override via AI_FACET_MODEL.
const FACET_MODEL = process.env.AI_FACET_MODEL ?? 'accounts/fireworks/models/gpt-oss-20b';

const SYSTEM_PROMPT = 'Ты анализируешь группу фрагментов из личных заметок пользователя на одну тему. Ответь СТРОГО на русском, обернув результат в XML-теги следующим образом:\n<label>короткое название темы, 1–4 слова</label>\n<description>5–8 предложений от третьего лица: подробно опиши, о чём пользователь пишет в этой теме, какие конкретные ситуации, люди и детали упоминаются, какие чувства и внутренние конфликты повторяются, как меняется отношение со временем. Приводи конкретные детали из текста, а не общие фразы</description>\nНЕ рассуждай вслух, не описывай задачу, не пиши «мы имеем заметки» — сразу результат. Опирайся ТОЛЬКО на приведённые фрагменты, ничего не выдумывай.';

export const summarizeFacet = onCall({
  secrets: ['GEMINI_API_KEY', 'FIREWORKS_API_KEY'],
  timeoutSeconds: 60,
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }
  const uid = request.auth.uid;

  if (!(await tryReserveGlobalRequest())) {
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    console.error('[AI facet] validation failed:', JSON.stringify(parsed.error.issues));
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const notesText = parsed.data.notes
    .map((n, i) => `Заметка ${i + 1} «${sanitizeAiInput(n.title)}»:\n${sanitizeAiInput(n.excerpt)}`)
    .join('\n\n');

  const focus = parsed.data.focus ? sanitizeAiInput(parsed.data.focus) : '';
  const system = focus
    ? `${SYSTEM_PROMPT} Опиши ТОЛЬКО то, что относится к теме «${focus}»; игнорируй формат дневника и всё постороннее. Если про эту тему почти ничего нет — одно предложение об этом.`
    : SYSTEM_PROMPT;

  try {
    const result = await generate({
      system,
      messages: [{ role: 'user', content: `Фрагменты заметок${focus ? ` (тема «${focus}»)` : ''}:\n\n${notesText}` }],
      json: false,
      maxTokens: 1500,
      model: FACET_MODEL,
      abortMs: 50_000,
    });

    recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'facet' }).catch(e =>
      console.error('[AI facet] usage record failed:', e),
    );

    const text = result.text.trim();
    // Reasoning-model leakage markers + English — these must never reach a card.
    const META = /мы (имеем|должны)|нужно (определить|проанализ)|проанализир|\bwe need\b|the (user|notes|theme)|given notes|<think>|похоже,?\s*что|возможно,?\s*(это|жен)|в заметке\s*\d|из заметок|предложени[яй] от третьего/i;
    const cyr = (s: string) => (s.match(/[а-яё]/gi) ?? []).length;

    // XML tag extraction (robust to preamble/reasoning). Fallback to legacy
    // НАЗВАНИЕ:/ОПИСАНИЕ: markers for backward compat with old model output.
    let label = (text.match(/<label>([\s\S]*?)<\/label>/i)?.[1] ?? '').trim().replace(/[«»"]/g, '');
    if (!label) label = (text.match(/НАЗВАНИЕ\s*:\s*(.+)/i)?.[1] ?? '').trim().replace(/[«»"]/g, '');

    let summary = (text.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? '').trim();
    if (!summary) {
      // Legacy fallback
      summary = text.split(/ОПИСАНИЕ\s*:|опиш[уи]\s*:/i).pop()?.trim() ?? '';
      summary = summary.replace(/\n+НАЗВАНИЕ\s*:[\s\S]*$/i, '').trim();
    }
    // Handle unclosed tags (model truncated mid-output)
    if (!summary && text.includes('<description>')) {
      summary = text.slice(text.indexOf('<description>') + '<description>'.length).trim();
    }

    // Reject reasoning / English leakage so the client builds a clean fallback.
    // Also reject clearly truncated summaries (ending mid-sentence without punctuation).
    let finalLabel = label;
    const truncated = summary.length > 0 && !/[.!?]$/.test(summary);
    if (!summary || META.test(summary) || cyr(summary) < summary.length * 0.3 || (truncated && summary.length < 200)) { finalLabel = ''; summary = ''; }
    if (finalLabel && (META.test(finalLabel) || cyr(finalLabel) === 0)) finalLabel = '';
    if (!finalLabel && summary) {
      finalLabel = summary.split(/[.!?\n]/)[0]!.split(/\s+/).slice(0, 5).join(' ').slice(0, 48);
    }

    const cleanLabel = sanitizeAiResponse(finalLabel);
    const cleanSummary = sanitizeAiResponse(summary);
    return { label: cleanLabel, summary: cleanSummary };
  } catch (e) {
    await refundGlobalRequest();
    console.error('[AI facet] failed:', e);
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new HttpsError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new HttpsError('internal', 'Facet summarization failed.');
  }
});
