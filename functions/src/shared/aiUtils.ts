import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from './firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';
import DOMPurify from 'isomorphic-dompurify';
import { Langfuse } from 'langfuse';

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

let _langfuse: Langfuse | null = null;

export function getLangfuse(): Langfuse | null {
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  if (!secretKey || !publicKey) return null;
  if (!_langfuse) {
    _langfuse = new Langfuse({ secretKey, publicKey, flushAt: 1, fetchRetryCount: 1 });
  }
  return _langfuse;
}

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

export async function recordUsage(uid: string, tokensIn: number, tokensOut: number): Promise<void> {
  const db = getDb();
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

export const DAILY_LIMIT = (() => {
  const raw = process.env.AI_DAILY_LIMIT;
  if (!raw) return 5;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? 5 : parsed;
})();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

// Project-wide Gemini rate-limit guardrails. Defaults are Google's documented
// Tier 1 limits for gemini-2.5-flash (RPM 1,000 / TPM 1,000,000 / RPD 10,000);
// verify against your live limits at https://aistudio.google.com/rate-limit and
// override via env. tokensPerDay is a cost guard (no daily token cap exists on
// Tier 1) sized so it doesn't bind before RPD under normal use.
// Keep these numbers in sync with the mirror in api/chat.ts.
export const TIER_LIMITS = {
  requestsPerDay: envInt('AI_TIER_RPD', 10_000),
  tokensPerDay: envInt('AI_TIER_TPD', 25_000_000),
  requestsPerMinute: envInt('AI_TIER_RPM', 1_000),
  tokensPerMinute: envInt('AI_TIER_TPM', 1_000_000),
};

// Sums today's usage across ALL users (same `daily` collection group the admin
// stats read). Cheap at free-tier scale (≤ a few hundred docs).
export async function getGlobalDailyUsage(): Promise<{ requests: number; promptTokens: number; completionTokens: number }> {
  const db = getDb();
  const date = new Date().toISOString().slice(0, 10);
  const snap = await db.collectionGroup('daily').where('date', '==', date).get();
  let requests = 0, promptTokens = 0, completionTokens = 0;
  snap.forEach(d => {
    const x = d.data();
    requests += x.requests ?? 0;
    promptTokens += x.promptTokens ?? 0;
    completionTokens += x.completionTokens ?? 0;
  });
  return { requests, promptTokens, completionTokens };
}

// True when one more request would still stay within the free-tier daily caps.
export async function withinGlobalDailyLimit(): Promise<boolean> {
  const u = await getGlobalDailyUsage();
  return u.requests < TIER_LIMITS.requestsPerDay
    && (u.promptTokens + u.completionTokens) < TIER_LIMITS.tokensPerDay;
}

export async function checkDailyLimit(uid: string): Promise<boolean> {
  const db = getDb();

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
  const db = getDb();
  const date = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`aiDailyLimit/${uid}`);
  const snap = await ref.get();
  const data = snap.data();
  if (!data || data.date !== date) return { used: 0, date };
  return { used: data.count, date };
}

const COOLDOWN_MS = 10000;

export async function checkRateLimit(uid: string): Promise<boolean> {
  const db = getDb();
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
