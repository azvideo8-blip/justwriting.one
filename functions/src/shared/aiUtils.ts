import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';
import DOMPurify from 'isomorphic-dompurify';

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

let _genAI: GoogleGenerativeAI | null = null;

export function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');
    _genAI = new GoogleGenerativeAI(apiKey);
  }
  return _genAI;
}

export const genAI = new Proxy({} as GoogleGenerativeAI, {
  get(_target, prop) {
    return Reflect.get(getGenAI(), prop);
  },
});

const MAX_AI_CONTENT_LENGTH = 50_000;

export const INJECTION_PATTERNS = [
  /ignore\s+previous/i,
  /ignore\s+instructions/i,
  /jailbreak/i,
  /\bDAN\b/i,
  /you\s+are\s+now/i,
  /forget\s+your/i,
  /новые\s+инструкции/i,
  /забудь/i,
];

export function sanitizeAiInput(content: string): string {
  let sanitized = content.slice(0, MAX_AI_CONTENT_LENGTH);
  sanitized = sanitized.replace(/<\|system\|>/gi, '[system]');
  sanitized = sanitized.replace(/<\|user\|>/gi, '[user]');
  sanitized = sanitized.replace(/<\|assistant\|>/gi, '[assistant]');
  return sanitized;
}

export function sanitizeAiResponse(response: string): string {
  return DOMPurify.sanitize(response, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    ALLOW_DATA_ATTR: false,
  });
}

export function sanitizeStringFields<T extends Record<string, unknown>>(
  obj: T,
  fields: (keyof T)[]
): T {
  const result = { ...obj };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === 'string') {
      (result as Record<string, unknown>)[field as string] = sanitizeAiResponse(value);
    } else if (Array.isArray(value)) {
      (result as Record<string, unknown>)[field as string] = value.map(item =>
        typeof item === 'string' ? sanitizeAiResponse(item) : item
      );
    }
  }
  return result;
}

export async function recordUsage(uid: string, tokensIn: number, tokensOut: number): Promise<void> {
  const db = getFirestore('ai-studio-26638cb9-0855-4980-84cb-072afd2a063d');
  const date = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`aiUsage/${uid}/daily/${date}`);
  await ref.set({
    date,
    promptTokens: FieldValue.increment(tokensIn),
    completionTokens: FieldValue.increment(tokensOut),
    requests: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

const DAILY_LIMIT = process.env.AI_DAILY_LIMIT ? parseInt(process.env.AI_DAILY_LIMIT, 10) : 50;

export async function checkDailyLimit(uid: string): Promise<boolean> {
  const db = getFirestore('ai-studio-26638cb9-0855-4980-84cb-072afd2a063d');

  const userSnap = await db.doc(`users/${uid}`).get();
  if (userSnap.exists && userSnap.data()?.role === 'admin') {
    return true;
  }

  const date = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`aiDailyLimit/${uid}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();

    if (!data || data.date !== date) {
      tx.set(ref, { count: 1, date });
      return true;
    }
    if (data.count >= DAILY_LIMIT) return false;
    tx.update(ref, { count: data.count + 1 });
    return true;
  });
}

export async function getDailyLimitCount(uid: string): Promise<{ used: number; date: string }> {
  const db = getFirestore('ai-studio-26638cb9-0855-4980-84cb-072afd2a063d');
  const date = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`aiDailyLimit/${uid}`);
  const snap = await ref.get();
  const data = snap.data();
  if (!data || data.date !== date) return { used: 0, date };
  return { used: data.count, date };
}

const COOLDOWN_MS = 3000;

export async function checkRateLimit(uid: string): Promise<boolean> {
  const db = getFirestore('ai-studio-26638cb9-0855-4980-84cb-072afd2a063d');
  const ref = db.doc(`aiCooldown/${uid}`);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (data && now - data.lastRequestAt < COOLDOWN_MS) return false;
    tx.set(ref, { lastRequestAt: now }, { merge: true });
    return true;
  });
}
