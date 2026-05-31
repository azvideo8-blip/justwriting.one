import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { SchemaType } from '@google/generative-ai';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, checkDailyLimit, getDailyLimitCount, checkRateLimit, GEMINI_MODEL, getGenAI, getLangfuse } from '../shared/aiUtils';

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
  secrets: ['GEMINI_API_KEY'],
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Registration required.');
  }

  const uid = request.auth.uid;

  if (!(await checkDailyLimit(uid))) {
    const { used, date } = await getDailyLimitCount(uid);
    throw new HttpsError('resource-exhausted', `Daily limit reached. Used ${used}/${process.env.AI_DAILY_LIMIT ?? 50} on ${date}.`);
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

  const model = getGenAI().getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: SUMMARY_SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          tone: { type: SchemaType.STRING },
          frequentWords: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          insights: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          themes: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          extractedFacts: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        },
        required: ['tone', 'frequentWords', 'insights', 'themes', 'extractedFacts'],
      },
    },
  });

  const safeMood = mood ? sanitizeAiInput(mood) : null;
  const prompt = safeMood
    ? `[Настроение документа: ${safeMood}]\n\n${sanitizedContent}`
    : sanitizedContent;

  const lf = getLangfuse();
  const trace = lf?.trace({ name: 'summarizeDocument', userId: uid });
  const generation = trace?.generation({ name: 'gemini', model: GEMINI_MODEL, input: prompt });

  let text: string;
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let result;
    try {
      result = await model.generateContent(prompt, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    const response = result.response;
    text = response.text();
    tokensIn = response.usageMetadata?.promptTokenCount ?? 0;
    tokensOut = response.usageMetadata?.candidatesTokenCount ?? 0;
  } catch (e) {
    generation?.end({ output: String(e), level: 'ERROR' });
    if (lf) await lf.flushAsync().catch(() => {});
    throw new HttpsError('internal', 'AI summarization failed.');
  }

  let parsed_json: { tone: string; frequentWords: string[]; insights: string[]; themes: string[]; extractedFacts: string[] };
  try {
    parsed_json = JSON.parse(text);
  } catch {
    generation?.end({ output: text, level: 'ERROR' });
    if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));
    throw new HttpsError('internal', 'Failed to parse summary.');
  }

  generation?.end({ output: text, usage: { promptTokens: tokensIn, completionTokens: tokensOut } });
  recordUsage(uid, tokensIn, tokensOut).catch(e => console.error('[AI summarize] usage record failed:', e));
  if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));

  return {
    tone: sanitizeAiResponse(parsed_json.tone),
    frequentWords: (parsed_json.frequentWords ?? []).map(sanitizeAiResponse),
    insights: (parsed_json.insights ?? []).map(sanitizeAiResponse),
    themes: (parsed_json.themes ?? []).map(sanitizeAiResponse),
    extractedFacts: (parsed_json.extractedFacts ?? []).map(sanitizeAiResponse),
  };
});
