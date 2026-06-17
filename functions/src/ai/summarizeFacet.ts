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
});

const SYSTEM_PROMPT = 'Ты анализируешь группу личных заметок пользователя, объединённых одной темой. Верни ТОЛЬКО валидный JSON-объект вида {"label":"...","summary":"..."}. label — короткое название темы на русском (1–4 слова: человек, чувство, сфера жизни или паттерн). summary — 2–4 предложения: о чём пользователь пишет в этой теме, какие чувства, детали и паттерны повторяются. Опирайся ИСКЛЮЧИТЕЛЬНО на приведённые заметки, ничего не выдумывай.';

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

  try {
    const result = await generate({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Заметки одной темы:\n\n${notesText}\n\nВерни только {"label":"...","summary":"..."}.` }],
      json: true,
      maxTokens: 512,
      abortMs: 50_000,
    });

    recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'facet' }).catch(e =>
      console.error('[AI facet] usage record failed:', e),
    );

    let label = '';
    let summary = '';
    try {
      const obj = JSON.parse(result.text) as { label?: unknown; summary?: unknown };
      if (typeof obj.label === 'string') label = obj.label.trim();
      if (typeof obj.summary === 'string') summary = obj.summary.trim();
    } catch { /* leave empty */ }

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
