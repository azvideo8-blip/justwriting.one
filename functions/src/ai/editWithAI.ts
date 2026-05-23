import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';

const MAX_AI_CONTENT_LENGTH = 50_000;
const RATE_LIMIT_MAX = 10; // [S-05] снижено с 20 до 10 req/min
const RATE_LIMIT_WINDOW_MS = 60_000;

const actionSchema = z.enum(['shorten', 'accents', 'ideas', 'summarize', 'tags', 'mood', 'continue']);

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(10_000),
});

const inputSchema = z.object({
  content: z.string().min(1).max(MAX_AI_CONTENT_LENGTH),
  action: actionSchema,
  sessionId: z.string().optional(),
  history: z.array(messageSchema).max(10).optional(),
});

function sanitizeAiInput(content: string): string {
  let sanitized = content.slice(0, MAX_AI_CONTENT_LENGTH);
  sanitized = sanitized.replace(/<\|system\|>/gi, '[system]');
  sanitized = sanitized.replace(/<\|user\|>/gi, '[user]');
  sanitized = sanitized.replace(/<\|assistant\|>/gi, '[assistant]');
  return sanitized;
}

function sanitizeAiResponse(response: string): string {
  // [S-04] Безопасная XSS-санитизация с помощью DOMPurify: удаляем все HTML-теги и JS-атрибуты
  return DOMPurify.sanitize(response, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    ALLOW_DATA_ATTR: false,
  });
}

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
  apiKey: string,
  content: string,
  action: string,
  history?: { role: 'user' | 'assistant'; content: string }[]
): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const chatHistory = (history ?? []).map(m => ({
    role: m.role === 'assistant' ? 'model' as const : 'user' as const,
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history: chatHistory });
  const prompt = buildPrompt(action, content);
  const result = await chat.sendMessage(prompt);
  const response = result.response;
  return {
    text: response.text(),
    tokensIn: response.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: response.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

async function checkRateLimitFirestore(uid: string): Promise<boolean> {
  const db = getFirestore();
  const ref = db.doc(`aiRateLimit/${uid}`);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();

    if (!data || now > data.resetAt) {
      tx.set(ref, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }
    if (data.count >= RATE_LIMIT_MAX) return false;
    tx.update(ref, { count: data.count + 1 });
    return true;
  });
}

async function recordUsage(uid: string, tokensIn: number, tokensOut: number): Promise<void> {
  const db = getFirestore();
  const date = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`aiUsage/${uid}/daily/${date}`);
  await ref.set({
    promptTokens: FieldValue.increment(tokensIn),
    completionTokens: FieldValue.increment(tokensOut),
    requests: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export const editWithAI = onCall({
  secrets: ['GEMINI_API_KEY'],
  enforceAppCheck: true,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const uid = request.auth.uid;

  if (!(await checkRateLimitFirestore(uid))) {
    throw new HttpsError('resource-exhausted', 'Too many requests. Try again in a minute.');
  }

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { content, action, sessionId, history } = parsed.data;
  const sanitizedInput = sanitizeAiInput(content);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new HttpsError('internal', 'AI service not configured.');

  const { text, tokensIn, tokensOut } = await callGemini(apiKey, sanitizedInput, action, history);
  const sanitizedOutput = sanitizeAiResponse(text);

  recordUsage(uid, tokensIn, tokensOut).catch(e => console.error('[AI] usage record failed:', e));

  if (sessionId) {
    const db = getFirestore();
    const docRef = db.doc(`sessions/${sessionId}`);
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.userId !== uid) {
      throw new HttpsError('permission-denied', 'Session not found or not owned.');
    }

    await docRef.update({
      _aiProcessed: true,
      _aiAction: action,
      _aiProcessedAt: new Date(),
    });
  }

  return { result: sanitizedOutput };
});
