import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, recordUsage, withinGlobalDailyLimit } from '../shared/aiUtils';
import { generate } from '../shared/aiProvider';

// Summarizes one cluster of the user's notes into a profile facet (label +
// description). Like embed/rerank this is profile infrastructure — exempt from
// the per-user chat limits, guarded only by the project-wide cost cap.

const inputSchema = z.object({
  notes: z.array(z.object({
    title: z.string().max(300),
    excerpt: z.string().max(2_000),
  })).min(1).max(40),
  focus: z.string().max(120).optional(),
});

const SYSTEM_PROMPT = 'Ты анализируешь группу фрагментов из личных заметок пользователя на одну тему. Ответь СТРОГО на русском, РОВНО в таком формате и без любых других слов:\nНАЗВАНИЕ: <короткое название темы, 1–4 слова>\nОПИСАНИЕ: <2–4 предложения от третьего лица: о чём пользователь пишет, какие чувства, детали и паттерны повторяются>\nНЕ рассуждай вслух, не описывай задачу, не пиши «мы имеем заметки» — сразу результат. Опирайся ТОЛЬКО на приведённые фрагменты, ничего не выдумывай.';

export const summarizeFacet = onCall({
  secrets: ['GEMINI_API_KEY', 'FIREWORKS_API_KEY'],
  timeoutSeconds: 60,
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }
  const uid = request.auth.uid;

  if (!(await withinGlobalDailyLimit())) {
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
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
      maxTokens: 400,
      abortMs: 50_000,
    });

    recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'facet' }).catch(e =>
      console.error('[AI facet] usage record failed:', e),
    );

    const text = result.text.trim();
    const META = /мы имеем|нужно (определить|проанализ)|\bwe need\b|the (user|notes|theme)|объединённых|given notes|<think>/i;
    const cyr = (s: string) => (s.match(/[а-яё]/gi) ?? []).length;

    let label = (text.match(/НАЗВАНИЕ\s*:\s*(.+)/i)?.[1] ?? '').trim();
    let summary = (text.match(/ОПИСАНИЕ\s*:\s*([\s\S]+)/i)?.[1] ?? '').trim();
    summary = summary.replace(/\n+НАЗВАНИЕ\s*:[\s\S]*$/i, '').trim();

    // Model ignored the format but may have given clean Russian prose — accept it.
    if (!summary && text && !META.test(text) && cyr(text) > text.length * 0.5) {
      summary = text.slice(0, 700);
    }

    // Reject reasoning / English leakage so the client builds a clean fallback.
    if (!summary || META.test(summary) || cyr(summary) < summary.length * 0.3) { label = ''; summary = ''; }
    if (label && (META.test(label) || cyr(label) === 0)) label = '';
    if (!label && summary) {
      label = summary.split(/[.!?\n]/)[0]!.split(/\s+/).slice(0, 5).join(' ').slice(0, 48);
    }

    return { label, summary };
  } catch (e) {
    console.error('[AI facet] failed:', e);
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new HttpsError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new HttpsError('internal', 'Facet summarization failed.');
  }
});
