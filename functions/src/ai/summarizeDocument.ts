import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, checkDailyLimit, getDailyLimitCount, checkRateLimit, GEMINI_MODEL, genAI } from '../shared/aiUtils';

const SUMMARY_SYSTEM_PROMPT = `Проанализируй текст и верни JSON-объект со следующими полями:
- tone: одно слово (нейтральный/задумчивый/тревожный/вдохновляющий/радостный/грустный/злой/усталый)
- frequentWords: массив из 5-7 наиболее значимых слов из текста (не стоп-слова)
- insights: массив из 3-5 коротких инсайтов или ключевых мыслей, которые звучат в тексте
- themes: массив из 2-4 основных тем

Верни ТОЛЬКО валидный JSON без пояснений и markdown-обёртки.`;

const inputSchema = z.object({
  content: z.string().min(50).max(50_000),
  mood: z.string().max(50).nullish(),
});

export const summarizeDocument = onCall({
  secrets: ['GEMINI_API_KEY'],
  enforceAppCheck: true,
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpsError('internal', 'AI service not configured.');

  const model = genAI.getGenerativeModel({
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
        },
        required: ['tone', 'frequentWords', 'insights', 'themes'],
      },
    },
  });

  const prompt = mood
    ? `[Настроение документа: ${mood}]\n\n${sanitizedContent}`
    : sanitizedContent;

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  let parsed_json: { tone: string; frequentWords: string[]; insights: string[]; themes: string[] };
  try {
    parsed_json = JSON.parse(text);
  } catch {
    throw new HttpsError('internal', 'Failed to parse summary.');
  }

  const tokensIn = response.usageMetadata?.promptTokenCount ?? 0;
  const tokensOut = response.usageMetadata?.candidatesTokenCount ?? 0;

  recordUsage(uid, tokensIn, tokensOut).catch(e => console.error('[AI summarize] usage record failed:', e));

  return {
    tone: sanitizeAiResponse(parsed_json.tone),
    frequentWords: parsed_json.frequentWords.map(sanitizeAiResponse),
    insights: parsed_json.insights.map(sanitizeAiResponse),
    themes: parsed_json.themes.map(sanitizeAiResponse),
  };
});
