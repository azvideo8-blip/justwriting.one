import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, checkDailyLimit, getDailyLimitCount, checkRateLimit, GEMINI_MODEL, getGenAI, getLangfuse } from '../shared/aiUtils';

const MAX_AI_CONTENT_LENGTH = 50_000;

const actionSchema = z.enum(['shorten', 'accents', 'ideas', 'summarize', 'tags', 'mood', 'continue']);

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(10_000),
});

const inputSchema = z.object({
  content: z.string().min(1).max(MAX_AI_CONTENT_LENGTH),
  action: actionSchema,
  sessionId: z.string().nullish(),
  history: z.array(messageSchema).max(10).nullish(),
});

const ACTION_PROMPTS: Record<string, string> = {
  shorten: 'Сократи текст, сохранив суть и стиль автора. Без пояснений — только результат.',
  accents: 'Выдели 3–5 ключевых мыслей из текста. Верни маркированный список.',
  ideas: 'Предложи 5 идей для развития темы. Кратко, одна строка каждая.',
  summarize: 'Краткое резюме в 2–3 предложениях.',
  tags: 'Верни JSON-массив из 3–7 тегов-ключевых слов, строчными, без `#`. Только JSON, без пояснений.',
  mood: 'Одним словом определи тональность текста (нейтральный / задумчивый / тревожный / вдохновляющий / радостный / грустный).',
  continue: 'Продолжи текст в том же стиле, ещё 2–3 абзаца.',
};

function buildPrompt(action: string, content: string): string {
  const task = ACTION_PROMPTS[action] ?? 'Обработай текст согласно действию.';
  return `${task}\n\nЯзык ответа должен совпадать с языком входного текста.\n\n${content}`;
}

async function callGemini(
  content: string,
  action: string,
  history?: { role: 'user' | 'assistant'; content: string }[]
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const ai = getGenAI();
  const model = ai.getGenerativeModel({ model: GEMINI_MODEL });

  const chatHistory = (history ?? []).map(m => ({
    role: m.role === 'assistant' ? 'model' as const : 'user' as const,
    parts: [{ text: sanitizeAiInput(m.content) }],
  }));

  const chat = model.startChat({ history: chatHistory });
  const prompt = buildPrompt(action, content);
  let result;
  try {
    result = await chat.sendMessage(prompt);
  } catch {
    throw new HttpsError('internal', 'AI request failed.');
  }
  const response = result.response;
  return {
    text: response.text(),
    tokensIn: response.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: response.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

export const editWithAI = onCall({
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

  const { content, action, sessionId, history } = parsed.data;
  const sanitizedInput = sanitizeAiInput(content);

  const lf = getLangfuse();
  const trace = lf?.trace({ name: 'editWithAI', userId: uid, metadata: { action } });
  const generation = trace?.generation({ name: 'gemini', model: GEMINI_MODEL, input: sanitizedInput });

  const { text, tokensIn, tokensOut } = await callGemini(sanitizedInput, action, history ?? undefined);
  const sanitizedOutput = sanitizeAiResponse(text);

  generation?.end({ output: sanitizedOutput, usage: { promptTokens: tokensIn, completionTokens: tokensOut } });
  recordUsage(uid, tokensIn, tokensOut).catch(e => console.error('[AI] usage record failed:', e));
  if (lf) await lf.flushAsync().catch(e => console.error('[Langfuse] flush failed:', e));

  if (sessionId) {
    const db = getFirestore();
    const docRef = db.doc(`sessions/${sessionId}`);
    await db.runTransaction(async (tx) => {
      const [userDoc, sessionDoc] = await Promise.all([
        tx.get(db.doc(`users/${uid}`)),
        tx.get(docRef),
      ]);
      const isAdmin = userDoc.exists && userDoc.data()?.role === 'admin';
      if (!sessionDoc.exists || (sessionDoc.data()?.userId !== uid && !isAdmin)) {
        throw new HttpsError('permission-denied', 'Session not found or not owned.');
      }
      tx.update(docRef, {
        _aiProcessed: true,
        _aiAction: action,
        _aiProcessedAt: FieldValue.serverTimestamp(),
        _aiResultText: sanitizedOutput,
      });
    });
  }

  return { result: sanitizedOutput };
});
