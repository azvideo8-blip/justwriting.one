import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, checkDailyLimit, checkRateLimit, withinGlobalDailyLimit, refundDailyLimit, getLangfuse } from '../shared/aiUtils';
import { generate, getActiveModel } from '../shared/aiProvider';

const SUMMARY_SYSTEM_PROMPT = `Проанализируй текст и верни JSON-объект со следующими полями:
- tone: одно слово (нейтральный/задумчивый/тревожный/вдохновляющий/радостный/грустный/злой/усталый)
- frequentWords: массив из 5-7 наиболее значимых слов из текста (не стоп-слова)
- insights: массив из 3-5 коротких инсайтов или ключевых мыслей, которые звучат в тексте
- themes: массив из 2-4 основных тем
- extractedFacts: массив из 2-5 конкретных фактов, событий или утверждений из текста (что именно произошло, что автор упоминает как реальное событие или утверждение)

Верни ТОЛЬКО валидный JSON без пояснений и markdown-обёртки.`;

const inputSchema = z.object({
  content: z.string().min(50).max(50_000),
  mood: z.string().max(50).nullish(),
});

export const summarizeDocument = onCall({
  secrets: ['GEMINI_API_KEY', 'FIREWORKS_API_KEY'],
  timeoutSeconds: 120,
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const uid = request.auth.uid;

  if (!(await withinGlobalDailyLimit())) {
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  if (!(await checkDailyLimit(uid))) {
    throw new HttpsError('resource-exhausted', 'Daily limit reached.');
  }

  if (!(await checkRateLimit(uid))) {
    throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a few seconds.');
  }

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { content, mood } = parsed.data;
  const sanitizedContent = sanitizeAiInput(content);

  const safeMood = mood ? sanitizeAiInput(mood) : null;
  const prompt = safeMood
    ? `[Настроение документа: ${safeMood}]\n\n${sanitizedContent}`
    : sanitizedContent;

  const lf = getLangfuse();
  const activeModel = await getActiveModel();
  const trace = lf?.trace({ name: 'summarizeDocument', userId: uid });
  const generation = trace?.generation({ name: activeModel, model: activeModel, input: prompt });

  let text: string;
  let tokensIn = 0;
  let tokensOut = 0;
  let usedModel = activeModel;
  try {
    const result = await generate({
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      json: true,
      maxTokens: 4096,
      abortMs: 110_000,
    });
    text = result.text;
    tokensIn = result.tokensIn;
    tokensOut = result.tokensOut;
    usedModel = result.model;
  } catch (e) {
    console.error('[AI summarize] generation failed:', e);
    generation?.end({ output: String(e), level: 'ERROR' });
    if (lf) await lf.flushAsync().catch(() => {});
    await refundDailyLimit(uid);
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new HttpsError('resource-exhausted', 'AI service is temporarily unavailable (quota/spend limit). Try again later.');
    }
    throw new HttpsError('internal', 'AI summarization failed.');
  }

  let parsed_json: { tone: string; frequentWords: string[]; insights: string[]; themes: string[]; extractedFacts: string[] };
  try {
    let textToParse = text.trim();
    if (textToParse.startsWith('```')) {
      textToParse = textToParse.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    }
    parsed_json = JSON.parse(textToParse);
  } catch {
    console.error('[AI summarize] failed to parse model output:', text.slice(0, 500));
    generation?.end({ output: text, level: 'ERROR' });
    if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));
    await refundDailyLimit(uid);
    throw new HttpsError('internal', 'Failed to parse summary.');
  }

  generation?.end({ output: text, usage: { promptTokens: tokensIn, completionTokens: tokensOut } });
  recordUsage(uid, tokensIn, tokensOut, { model: usedModel, fn: 'summarize' }).catch(e => console.error('[AI summarize] usage record failed:', e));
  if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));

  return {
    tone: sanitizeAiResponse(parsed_json.tone ?? 'neutral'),
    frequentWords: (parsed_json.frequentWords ?? []).map(sanitizeAiResponse),
    insights: (parsed_json.insights ?? []).map(sanitizeAiResponse),
    themes: (parsed_json.themes ?? []).map(sanitizeAiResponse),
    extractedFacts: (parsed_json.extractedFacts ?? []).map(sanitizeAiResponse),
  };
});
