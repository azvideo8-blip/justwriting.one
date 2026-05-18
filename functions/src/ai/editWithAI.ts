import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { z } from 'zod';

const MAX_AI_CONTENT_LENGTH = 50_000;
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(uid);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(uid, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function sanitizeAiInput(content: string): string {
  let sanitized = content.slice(0, MAX_AI_CONTENT_LENGTH);
  sanitized = sanitized.replace(/<\|system\|>/gi, '[system]');
  sanitized = sanitized.replace(/<\|user\|>/gi, '[user]');
  sanitized = sanitized.replace(/<\|assistant\|>/gi, '[assistant]');
  return sanitized;
}

function sanitizeAiResponse(response: string): string {
  return response
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:');
}

const actionSchema = z.enum(['shorten', 'accents', 'ideas']);

const inputSchema = z.object({
  content: z.string().min(1).max(MAX_AI_CONTENT_LENGTH),
  action: actionSchema,
  sessionId: z.string().optional(),
});

export const editWithAI = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const uid = request.auth.uid;

  if (!checkRateLimit(uid)) {
    throw new HttpsError('resource-exhausted', 'Too many requests. Try again in a minute.');
  }

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid payload.');
  }

  const { content, action, sessionId } = parsed.data;
  const sanitizedInput = sanitizeAiInput(content);

  // TODO: Call AI API here when provider is configured
  // const apiKey = process.env.AI_API_KEY;
  // if (!apiKey) throw new HttpsError('internal', 'AI service not configured.');
  // const aiResponse = await callAiApi(apiKey, sanitizedInput, action);
  const aiResponse = sanitizedInput;

  const sanitizedOutput = sanitizeAiResponse(aiResponse);

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
