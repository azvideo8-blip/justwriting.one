import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from './firestore';
import DOMPurify from 'isomorphic-dompurify';
import { Langfuse } from 'langfuse';

export const MAX_AI_CONTENT_LENGTH = 50_000;

// Mirror of src/shared/ai/injectionPatterns.ts — keep in sync.
// After migration to Supabase, both sides will import from a single shared package.

// Patterns written for Latin-script phrases. Checked against a homoglyph-
// folded copy of the input (see foldLatinHomoglyphs below) so that visually
// identical Cyrillic/Greek lookalikes (e.g. Cyrillic "i" in "ignore previous")
// don't bypass them.
const LATIN_PATTERNS = [
  /ignore\s+previous/i,
  /ignore\s+instructions/i,
  /jailbreak/i,
  /\bDAN\b/i,
  /you\s+are\s+now/i,
  /forget\s+your/i,
  /(^|\n)\s*system\s*:/i,
  /as\s+an\s+AI\b/i,
  /(^|\n)\s*developer\s*:/i,
  /<\|im_start\|>/i,
  /\[INST\]/i,
  /<developer>/i,
  /<end_of_turn>/i,
];

// Patterns written for Cyrillic/Russian phrases. Checked against the
// ORIGINAL (non-folded) text — folding to Latin would break these, since
// they need to match real Cyrillic letters.
const CYRILLIC_PATTERNS = [
  /новые\s+инструкции/i,
  /забудь\s+(вс[её]|свои|преды|инструк)/i,
];

// Flat list kept for compatibility with any lingering direct reference.
export const INJECTION_PATTERNS = [...LATIN_PATTERNS, ...CYRILLIC_PATTERNS];

// Zero-width/invisible Unicode code points an attacker can splice into a
// phrase to dodge a regex without changing how the text visibly renders.
// Expressed as numeric code points on purpose (not a regex literal, not a
// \u-escape string) — see the unicode note at the top of this prompt.
const ZERO_WIDTH_CODE_POINTS = new Set<number>([
  0x200B, 0x200C, 0x200D, 0xFEFF, 0x00AD, // zero-width space/joiners, BOM, soft hyphen
  0x2028, 0x2029, 0x202F, 0x205F,          // line/paragraph separators, narrow/medium math space
]);
function isInvisibleCodePoint(code: number): boolean {
  return ZERO_WIDTH_CODE_POINTS.has(code) || (code >= 0x2000 && code <= 0x200A); // general punctuation space block
}
function stripInvisible(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (!isInvisibleCodePoint(code)) out += ch;
  }
  return out;
}

// Cyrillic/Greek letters visually identical to a Latin letter in most fonts —
// used to spoof a Latin-script phrase (jailbreak, ignore previous, etc.) past
// a regex expecting real Latin letters. Deliberately a small, explicit map
// (not a general Unicode confusables table) — covers only letters that could
// plausibly stand in for a letter appearing in LATIN_PATTERNS above. These are
// ordinary printable Cyrillic letters (not invisible characters) — fine to
// type as normal literal characters, unlike ZERO_WIDTH_CODE_POINTS above.
const HOMOGLYPH_MAP: Record<string, string> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
  'х': 'x', 'у': 'y', 'і': 'i', 'ѕ': 's', 'һ': 'h',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M',
  'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T',
  'Х': 'X', 'У': 'Y',
};

function foldLatinHomoglyphs(text: string): string {
  let out = '';
  for (const ch of text) {
    out += HOMOGLYPH_MAP[ch] ?? ch;
  }
  return out;
}

export function hasInjectionAttempt(text: string): boolean {
  const stripped = stripInvisible(text);
  const latinFolded = foldLatinHomoglyphs(stripped);
  return LATIN_PATTERNS.some(p => p.test(latinFolded)) || CYRILLIC_PATTERNS.some(p => p.test(stripped));
}

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
    // Strip CJK characters leaked from model reasoning chains (gpt-oss/DeepSeek
    // internal thinking sometimes bleeds into content field).
    // Ranges: CJK Unified (4E00-9FFF), Extension A (3400-4DBF), Compat (F900-FAFF),
    // Radicals (2E80-2EFF), Symbols (3000-303F), Kana (3040-30FF).
    cleaned = cleaned.replace(/[⺀-⻿　-ヿ㐀-䶿一-鿿豈-﫿]/g, '');
    // Strip citation artifacts that gpt-oss appends to factual sentences
    // (e.g. "30 000 рублейreferences" or "степень awarded").
    cleaned = cleaned.replace(/([а-яёА-ЯЁ\d])(references?|sources?|citations?|awarded)\b/gi, '$1');
    // Collapse any double-spaces created by the strips above.
    cleaned = cleaned.replace(/  +/g, ' ').trim();
  }
  return DOMPurify.sanitize(cleaned, {
    ALLOWED_TAGS: keepReasoning ? ['reasoning', 'answer'] : [],
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
  
  // Global doc: requests and tokens sharded across 10 shards.
  const NUM_SHARDS = 10;
  const shardId = Math.floor(Math.random() * NUM_SHARDS).toString();
  batch.set(db.doc(`aiGlobalDaily/${date}/shards/${shardId}`), {
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

// Project-wide daily request/token budget guard for the OpenRouter chat model.
// Override via env. Keep these numbers in sync with the mirror in api/chat.ts.
export const TIER_LIMITS = {
  requestsPerDay: envInt('AI_TIER_RPD', 10_000),
  tokensPerDay: envInt('AI_TIER_TPD', 25_000_000),
  requestsPerMinute: envInt('AI_TIER_RPM', 1_000),
  tokensPerMinute: envInt('AI_TIER_TPM', 1_000_000),
};

// Atomically check and reserve a slot in the project-wide daily cap.
// Uses distributed sharding (10 shards) to prevent database write contention hotspots.
export async function tryReserveGlobalRequest(): Promise<boolean> {
  const db = getDb();
  const date = new Date().toISOString().slice(0, 10);

  const shardsSnap = await db.collection(`aiGlobalDaily/${date}/shards`).get();
  let requests = 0;
  let tokens = 0;
  shardsSnap.forEach(doc => {
    const data = doc.data();
    requests += data.requests ?? 0;
    tokens += (data.promptTokens ?? 0) + (data.completionTokens ?? 0);
  });

  if (requests >= TIER_LIMITS.requestsPerDay || tokens >= TIER_LIMITS.tokensPerDay) return false;

  const NUM_SHARDS = 10;
  const shardId = Math.floor(Math.random() * NUM_SHARDS).toString();
  const shardRef = db.doc(`aiGlobalDaily/${date}/shards/${shardId}`);
  await shardRef.set({
    requests: FieldValue.increment(1),
    date,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return true;
}

// Best-effort refund of one global daily request slot.
export async function refundGlobalRequest(): Promise<void> {
  const db = getDb();
  const date = new Date().toISOString().slice(0, 10);
  const NUM_SHARDS = 10;
  const shardId = Math.floor(Math.random() * NUM_SHARDS).toString();
  const shardRef = db.doc(`aiGlobalDaily/${date}/shards/${shardId}`);
  await shardRef.set({
    requests: FieldValue.increment(-1),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true }).catch(e => console.error('[AI] refundGlobalRequest failed:', e));
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

export type LimitCheckResult = true | 'DAILY_LIMIT' | 'RATE_LIMIT';

export async function checkAndIncrementLimit(uid: string, reasoning?: boolean): Promise<LimitCheckResult> {
  if (await isAdmin(uid)) return true;

  const db = getDb();
  const now = Date.now();
  const date = new Date().toISOString().slice(0, 10);
  const cooldownRef = db.doc(`aiCooldown/${uid}`);
  const dailyRef = db.doc(`aiDailyLimit/${uid}`);

  const baseLimit = await getUserDailyLimit(uid);
  const limit = reasoning ? Math.min(baseLimit, 5) : baseLimit;

  return db.runTransaction(async (tx) => {
    const [cooldownSnap, dailySnap] = await Promise.all([
      tx.get(cooldownRef),
      tx.get(dailyRef),
    ]);
    const cooldownData = cooldownSnap.data();
    if (cooldownData && now - cooldownData.lastRequestAt < COOLDOWN_MS) return 'RATE_LIMIT';
    const dailyData = dailySnap.data();
    if (dailyData && dailyData.date === date && dailyData.count >= limit) return 'DAILY_LIMIT';
    tx.set(cooldownRef, { lastRequestAt: now }, { merge: true });
    if (!dailyData || dailyData.date !== date) {
      tx.set(dailyRef, { count: 1, date });
    } else {
      tx.update(dailyRef, { count: dailyData.count + 1 });
    }
    return true;
  });
}

// ── Bulk Daily limit ─────────────────────────────────────────────────────────
export const BULK_DAILY_LIMIT = (() => {
  const raw = process.env.AI_BULK_DAILY_LIMIT;
  if (!raw) return 50;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? 50 : parsed;
})();

export async function checkAndIncrementBulkLimit(uid: string): Promise<boolean> {
  if (await isAdmin(uid)) return true;

  const db = getDb();
  const date = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`aiBulkDailyLimit/${uid}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();

    if (!data || data.date !== date) {
      tx.set(ref, { count: 1, date });
      return true;
    }
    if (data.count >= BULK_DAILY_LIMIT) return false;
    tx.update(ref, { count: data.count + 1 });
    return true;
  });
}

export async function refundBulkLimit(uid: string): Promise<void> {
  const db = getDb();
  const date = new Date().toISOString().slice(0, 10);
  const ref = db.doc(`aiBulkDailyLimit/${uid}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || data.date !== date) return;
    const next = Math.max(0, (data.count ?? 1) - 1);
    tx.update(ref, { count: next });
  }).catch(e => console.error('[AI] refundBulkLimit failed:', e));
}
