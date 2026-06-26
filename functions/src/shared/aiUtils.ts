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

export const MAX_AI_CONTENT_LENGTH = 50_000;

// Mirror of src/shared/ai/injectionPatterns.ts — keep in sync.
// After migration to Supabase, both sides will import from a single shared package.
export const INJECTION_PATTERNS = [
  /ignore\s+previous/i,
  /ignore\s+instructions/i,
  /jailbreak/i,
  /\bDAN\b/i,
  /you\s+are\s+now/i,
  /forget\s+your/i,
  /новые\s+инструкции/i,
  /забудь/i,
  /system\s*:/i,
  /as\s+an\s+AI/i,
  /developer\s*:/i,
  /<\|im_start\|>/i,
  /\[INST\]/i,
  /<developer>/i,
  /<end_of_turn>/i,
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
  sanitized = sanitized.replace(/<\|im_start\|>/gi, '[im_start]');
  sanitized = sanitized.replace(/<\|im_end\|>/gi, '[im_end]');
  sanitized = sanitized.replace(/\[INST\]/gi, '[inst]');
  sanitized = sanitized.replace(/<\/?developer>/gi, '[developer]');
  sanitized = sanitized.replace(/<end_of_turn>/gi, '[end_of_turn]');
  sanitized = sanitized.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '');
  sanitized = sanitized.replace(/[\u2000-\u200A\u2028\u2029\u202F\u205F]/g, ' ');
  return sanitized;
}

// Strips ALL HTML tags and attributes from AI responses using DOMPurify.
// Also strips reasoning artifacts (//<reasoning>, <reasoning>, thinking text)
// that reasoning models like DeepSeek may leak into responses.
// RSN-3: In reasoning mode, keep <reasoning>/<answer> text content.
export function sanitizeAiResponse(response: string, keepReasoning = false): string {
  let cleaned = response;
  if (!keepReasoning) {
    // OPT-8: Strip reasoning blocks that reasoning models leak into output
    cleaned = cleaned.replace(/\/\/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
    cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
    cleaned = cleaned.replace(/\/\/<reasoning>[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/<reasoning>[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/^\/\/<reasoning>/gim, '');
  }
  return DOMPurify.sanitize(cleaned, {
    ALLOWED_TAGS: keepReasoning ? [] : [],
    ALLOWED_ATTR: [],
    ALLOW_DATA_ATTR: false,
  });
}

export async function recordUsage(
  uid: string,
  tokensIn: number,
  tokensOut: number,
  options?: { model?: string; fn?: string }
): Promise<void> {
  const db = getDb();
  const date = new Date().toISOString().slice(0, 10);
  const batch = db.batch();
  const dailyPayload = {
    date,
    promptTokens: FieldValue.increment(tokensIn),
    completionTokens: FieldValue.increment(tokensOut),
    requests: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  };
  batch.set(db.doc(`aiUsage/${uid}/daily/${date}`), dailyPayload, { merge: true });
  // Global doc: requests already incremented atomically by tryReserveGlobalRequest;
  // only add token counts here.
  batch.set(db.doc(`aiGlobalDaily/${date}`), {
    date,
    promptTokens: FieldValue.increment(tokensIn),
    completionTokens: FieldValue.increment(tokensOut),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  // Per-request event for admin breakdown view
  const eventRef = db.collection(`aiUsage/${uid}/events`).doc();
  batch.set(eventRef, {
    date,
    ts: FieldValue.serverTimestamp(),
    tokensIn,
    tokensOut,
    model: options?.model ?? 'unknown',
    fn: options?.fn ?? 'unknown',
  });
  await batch.commit();
}

export const DAILY_LIMIT = (() => {
  const raw = process.env.AI_DAILY_LIMIT;
  if (!raw) return 10;
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

// Atomically check and reserve a slot in the project-wide daily cap.
// Prevents TOCTOU race where concurrent requests all pass the read check
// before any increment lands.
export async function tryReserveGlobalRequest(): Promise<boolean> {
  const db = getDb();
  const date = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`aiGlobalDaily/${date}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    const requests = d?.requests ?? 0;
    const tokens = (d?.promptTokens ?? 0) + (d?.completionTokens ?? 0);
    if (requests >= TIER_LIMITS.requestsPerDay || tokens >= TIER_LIMITS.tokensPerDay) return false;
    tx.set(ref, { requests: FieldValue.increment(1), date, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}

// Per-user daily cap with an admin bump: users with role 'admin' get
// AI_ADMIN_DAILY_LIMIT (default 100), everyone else keeps DAILY_LIMIT (5).
export const ADMIN_DAILY_LIMIT = envInt('AI_ADMIN_DAILY_LIMIT', 100);

// LX-2a: Check if a user is an admin (role from users/{uid}).
export async function isAdmin(uid: string): Promise<boolean> {
  try {
    const snap = await getDb().doc(`users/${uid}`).get();
    return snap.data()?.role === 'admin';
  } catch { return false; }
}

export async function getUserDailyLimit(uid: string): Promise<number> {
  try {
    const snap = await getDb().doc(`users/${uid}`).get();
    if (snap.data()?.role === 'admin') return ADMIN_DAILY_LIMIT;
  } catch { /* fall through to default */ }
  return DAILY_LIMIT;
}

// LX-2a: For admins, skip the per-user daily limit entirely.
export async function checkDailyLimit(uid: string, reasoning?: boolean): Promise<boolean> {
  const db = getDb();

  // Admins bypass the per-user limit
  const admin = await isAdmin(uid);
  if (admin) return true;

  const baseLimit = await getUserDailyLimit(uid);
  const limit = reasoning ? Math.min(baseLimit, 5) : baseLimit;
  const date = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`aiDailyLimit/${uid}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();

    if (!data || data.date !== date) {
      tx.set(ref, { count: 1, date });
      return true;
    }
    if (data.count >= limit) return false;
    tx.update(ref, { count: data.count + 1 });
    return true;
  });
}

// Refund one unit of today's per-user daily count. Call this when an AI request
// passed the limit checks (which already incremented the count) but then failed —
// otherwise transient/server errors silently burn the user's daily quota.
export async function refundDailyLimit(uid: string): Promise<void> {
  const db = getDb();
  const date = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`aiDailyLimit/${uid}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || data.date !== date) return;
    const next = Math.max(0, (data.count ?? 1) - 1);
    tx.update(ref, { count: next });
  }).catch(e => console.error('[AI] refundDailyLimit failed:', e));
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
  if (await isAdmin(uid)) return true;

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
