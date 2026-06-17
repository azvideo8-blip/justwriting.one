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

const SYSTEM_PROMPT = 'Ты анализируешь группу личных заметок пользователя, объединённых одной темой. Верни ТОЛЬКО валидный JSON-объект вида {"label":"...","summary":"..."}. Пиши СТРОГО на русском. НЕ описывай свою задачу, НЕ рассуждай вслух, НЕ пиши «мы имеем заметки» / «нужно проанализировать» — сразу содержательный результат. label — короткое название темы (1–4 слова: сфера жизни, чувство или паттерн). summary — 2–4 предложения от третьего лица: о чём пользователь пишет в этой теме, какие чувства, детали и паттерны повторяются. Опирайся ИСКЛЮЧИТЕЛЬНО на приведённые заметки, ничего не выдумывай.';

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
    ? `${SYSTEM_PROMPT} ВАЖНО: опиши ТОЛЬКО то, что относится к теме «${focus}». Игнорируй всё, что к ней не относится. НЕ описывай сам формат (дневник, аскеза, ежедневные записи) и повседневную рутину в целом — только содержание и паттерны по теме «${focus}». Если про эту тему в заметках почти ничего нет — верни summary из одного предложения об этом.`
    : SYSTEM_PROMPT;

  try {
    const result = await generate({
      system,
      messages: [{ role: 'user', content: `Заметки${focus ? ` (тебя интересует только тема «${focus}»)` : ''}:\n\n${notesText}\n\nВерни только {"label":"...","summary":"..."}.` }],
      json: true,
      maxTokens: 512,
      abortMs: 50_000,
    });

    recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'facet' }).catch(e =>
      console.error('[AI facet] usage record failed:', e),
    );

    let label = '';
    let summary = '';
    let raw = result.text.trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    try {
      const obj = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as { label?: unknown; summary?: unknown };
      if (typeof obj.label === 'string') label = obj.label.trim();
      if (typeof obj.summary === 'string') summary = obj.summary.trim();
    } catch { /* leave empty — caller builds a clean fallback */ }

    // Reject the model's meta-narration / reasoning leakage and English output.
    // Returning empty makes the client fall back to a clean local summary instead
    // of showing "Мы имеем заметки…" / "We need to analyze…" in the card.
    const META = /мы имеем|нужно (определить|проанализ)|\bwe need\b|the (user|notes|theme)|объединённых одной темой|given notes/i;
    const cyrillic = (summary.match(/[а-яё]/gi) ?? []).length;
    const looksBad = !summary || META.test(summary) || META.test(label) || cyrillic < summary.length * 0.3;
    if (looksBad) { label = ''; summary = ''; }

    // Derive a label from a clean summary if the model omitted one.
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
