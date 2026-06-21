import type { VercelRequest, VercelResponse } from '@vercel/node';
import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { initializeApp, getApps, cert, applicationDefault, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { z } from 'zod';
import { INJECTION_PATTERNS } from '../src/shared/ai/injectionPatterns.js';
import { buildChatSystemPrompt, sanitizeAiInputShared } from '../src/shared/ai/buildChatPrompt.js';

// Must match the database the Cloud Functions and frontend use (shared/firestore.ts,
// VITE_FIREBASE_FIRESTORE_DATABASE_ID). Bare getFirestore() targets "(default)", which
// is a different, empty database — that mismatch hid usage stats and broke limit resets.
const FIRESTORE_DATABASE_ID = 'ai-studio-26638cb9-0855-4980-84cb-072afd2a063d';
const db = () => getFirestore(FIRESTORE_DATABASE_ID);

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

// Mirror of functions/src/shared/aiUtils.ts TIER_LIMITS (Gemini Tier 1 for
// gemini-2.5-flash) — keep in sync.
const TIER_LIMITS = {
  requestsPerDay: envInt('AI_TIER_RPD', 10_000),
  tokensPerDay: envInt('AI_TIER_TPD', 25_000_000),
};

// True when one more request stays within the project-wide free-tier daily caps.
async function withinGlobalDailyLimit(): Promise<boolean> {
  const date = new Date().toISOString().slice(0, 10);
  const snap = await db().doc(`aiGlobalDaily/${date}`).get();
  const d = snap.data();
  const requests = d?.requests ?? 0;
  const tokens = (d?.promptTokens ?? 0) + (d?.completionTokens ?? 0);
  return requests < TIER_LIMITS.requestsPerDay && tokens < TIER_LIMITS.tokensPerDay;
}

// ── Firebase Admin init ───────────────────────────────────────────────────────
if (getApps().length === 0) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  let credentialConfig: ServiceAccount | undefined;
  if (sa) {
    try {
      let trimmed = sa.trim();
      
      // Handle outer quotes
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        try {
          const unwrapped = JSON.parse(trimmed);
          if (typeof unwrapped === 'string') {
            trimmed = unwrapped.trim();
          } else {
            credentialConfig = unwrapped;
          }
        } catch {
          trimmed = trimmed.slice(1, -1).trim();
        }
      }

      if (!credentialConfig) {
        // Handle missing curly braces
        if (!trimmed.startsWith('{') && (trimmed.includes('"type"') || trimmed.includes('type:'))) {
          try {
            credentialConfig = JSON.parse(`{${trimmed}}`);
          } catch {
            // fallback to standard parsing
          }
        }
      }

      if (!credentialConfig) {
        credentialConfig = JSON.parse(trimmed);
      }
    } catch (err) {
      console.error('Failed to parse service account key:', err);
    }
  }

  initializeApp({
    credential: credentialConfig
      ? cert(credentialConfig)
      : applicationDefault(),
  });
}

// Initialize Google AI SDK with GEMINI_API_KEY as fallback
const googleApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const googleOptions: { apiKey?: string } = {};
if (googleApiKey) {
  googleOptions.apiKey = googleApiKey;
}
const google = createGoogleGenerativeAI(googleOptions);

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

// Provider seam: switch the streaming chat model via AI_PROVIDER. Fireworks is
// OpenAI-compatible, so a Fireworks-hosted model (e.g. DeepSeek v4 pro) runs
// through the OpenAI provider pointed at Fireworks' /chat/completions endpoint.
// Keep in sync with functions/src/shared/aiProvider.ts.
const AI_PROVIDER = (process.env.AI_PROVIDER ?? 'fireworks').toLowerCase();
const FIREWORKS_MODEL = process.env.FIREWORKS_MODEL ?? 'accounts/fireworks/models/deepseek-v4-pro';
const fireworksOptions: { baseURL: string; apiKey?: string } = {
  baseURL: 'https://api.fireworks.ai/inference/v1',
};
if (process.env.FIREWORKS_API_KEY) {
  fireworksOptions.apiKey = process.env.FIREWORKS_API_KEY;
}
const fireworks = createOpenAI(fireworksOptions);

// Active model config: read from Firestore appConfig/ai with 60s in-memory cache.
// Falls back to FIREWORKS_MODEL env var if Firestore read fails or doc is absent.
let _modelCache: { model: string; expiresAt: number } | null = null;
async function getActiveModel(): Promise<string> {
  const now = Date.now();
  if (_modelCache && now < _modelCache.expiresAt) return _modelCache.model;
  try {
    const snap = await db().doc('appConfig/ai').get();
    const m = snap.data()?.model as string | undefined;
    if (m && m.length > 0) { _modelCache = { model: m, expiresAt: now + 60_000 }; return m; }
  } catch { /* fall through */ }
  return FIREWORKS_MODEL;
}

async function getChatModel() {
  if (AI_PROVIDER === 'fireworks') return fireworks.chat(await getActiveModel());
  return google(GEMINI_MODEL);
}

// CHATFIX-6: buildSystemPrompt and sanitizeAiInput moved to shared module
// (src/shared/ai/buildChatPrompt.ts). Local wrappers kept for backwards compat.
function sanitizeAiInput(content: string): string {
  return sanitizeAiInputShared(content);
}

// ── Daily limit ───────────────────────────────────────────────────────────────
const DAILY_LIMIT = (() => {
  const n = parseInt(process.env.AI_DAILY_LIMIT ?? '10', 10);
  return Number.isNaN(n) ? 5 : n;
})();

// Admins (role 'admin') get a higher personal cap. Mirror of
// functions/src/shared/aiUtils.ts getUserDailyLimit.
const ADMIN_DAILY_LIMIT = (() => {
  const n = parseInt(process.env.AI_ADMIN_DAILY_LIMIT ?? '100', 10);
  return Number.isNaN(n) ? 100 : n;
})();

async function userDailyLimit(uid: string): Promise<number> {
  try {
    const snap = await db().doc(`users/${uid}`).get();
    if (snap.data()?.role === 'admin') return ADMIN_DAILY_LIMIT;
  } catch { /* fall through to default */ }
  return DAILY_LIMIT;
}

const COOLDOWN_MS = 10_000;

async function checkAndIncrementLimit(uid: string, responseLength?: string | null): Promise<boolean> {
  const fs = db();
  const now = Date.now();

  const cooldownRef = fs.doc(`aiCooldown/${uid}`);
  const cooldownAllowed = await fs.runTransaction(async (tx) => {
    const snap = await tx.get(cooldownRef);
    const data = snap.data();
    if (data && now - data.lastRequestAt < COOLDOWN_MS) return false;
    tx.set(cooldownRef, { lastRequestAt: now }, { merge: true });
    return true;
  });
  if (!cooldownAllowed) return false;

  // TICKET-049: Reasoning mode gets reduced limit (5 instead of 10)
  const baseLimit = await userDailyLimit(uid);
  const limit = responseLength === 'reasoning' ? Math.min(baseLimit, 5) : baseLimit;
  const date = new Date().toISOString().slice(0, 10);
  const ref = fs.doc(`aiDailyLimit/${uid}`);

  return fs.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || data.date !== date) { tx.set(ref, { count: 1, date }); return true; }
    if (data.count >= limit) return false;
    tx.update(ref, { count: data.count + 1 });
    return true;
  });
}

// Mirror functions/src/shared/aiUtils.ts recordUsage so streamed chats show up in
// admin AI stats (getAIUsageStats reads the `daily` collection group).
async function recordUsage(uid: string, tokensIn: number, tokensOut: number, model: string): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const fs = db();
  const batch = fs.batch();
  const payload = {
    date,
    promptTokens: FieldValue.increment(tokensIn),
    completionTokens: FieldValue.increment(tokensOut),
    requests: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  };
  batch.set(fs.doc(`aiUsage/${uid}/daily/${date}`), payload, { merge: true });
  batch.set(fs.doc(`aiGlobalDaily/${date}`), payload, { merge: true });
  // Per-request event for admin breakdown
  const eventRef = fs.collection(`aiUsage/${uid}/events`).doc();
  batch.set(eventRef, { date, ts: FieldValue.serverTimestamp(), tokensIn, tokensOut, model, fn: 'chat-stream' });
  await batch.commit();
}

// RSN: Reasoning mode. The Fireworks reasoning model emits its chain-of-thought
// in the separate `reasoning_content` delta channel, which @ai-sdk/openai does
// NOT surface (it only maps OpenAI o-series reasoning summaries). So for
// reasoning mode we stream Fireworks' /chat/completions directly, reading both
// channels and synthesizing the plain-text section markers the client parser
// expects ("ХОД МЫСЛИ:" / "ОТВЕТ:"). If the active model emits no reasoning,
// we just stream the answer (no empty reasoning section).
type FwDelta = { reasoning_content?: string; reasoning?: string; content?: string };
type FwChunk = {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  choices?: Array<{ delta?: FwDelta }>;
};
async function streamFireworksReasoning(
  res: VercelResponse,
  uid: string,
  model: string,
  system: string,
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  const upstream = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.FIREWORKS_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      stream: true,
      max_tokens: 16384,
      stream_options: { include_usage: true },
    }),
  });

  if (!upstream.ok || !upstream.body) {
    res.status(502).end('UPSTREAM_ERROR');
    return;
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let wroteReasoningHeader = false;
  let wroteAnswerHeader = false;
  let tokensIn = 0;
  let tokensOut = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let chunk: FwChunk;
      try { chunk = JSON.parse(data) as FwChunk; } catch { continue; }
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens ?? tokensIn;
        tokensOut = chunk.usage.completion_tokens ?? tokensOut;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      const content = delta.content;
      if (reasoning) {
        if (!wroteReasoningHeader) { res.write('ХОД МЫСЛИ:\n'); wroteReasoningHeader = true; }
        res.write(reasoning);
      }
      if (content) {
        if (!wroteAnswerHeader) {
          if (wroteReasoningHeader) res.write('\n\nОТВЕТ:\n');
          wroteAnswerHeader = true;
        }
        res.write(content);
      }
    }
  }
  res.end();
  try {
    await recordUsage(uid, tokensIn, tokensOut, model);
  } catch (e) {
    console.error('[api/chat] usage record failed:', e);
  }
}

// ── Input schema ──────────────────────────────────────────────────────────────
const inputSchema = z.object({
  personaId: z.enum(['group_psychology', 'cbt', 'coach', 'editor', 'parts', 'custom']),
  customSystemPrompt: z.string().max(500).nullish(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(10_000),
  })).max(100).refine(
    msgs => msgs.reduce((sum, m) => sum + m.content.length, 0) <= 200_000,
    'Total messages content exceeds 200K characters',
  ),
  documentContent: z.string().max(50_000).nullish(),
  documentMood: z.string().max(50).nullish(),
  userPortrait: z.string().max(100_000).nullish(),
  responseLength: z.enum(['short', 'standard', 'detailed', 'reasoning']).nullish(),
});

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  // Auth
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const idToken = auth.slice(7);

  let uid: string;
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }

  // Project-wide free-tier guard (across all users + resets)
  if (!(await withinGlobalDailyLimit())) { res.status(429).json({ error: 'GLOBAL_LIMIT' }); return; }

  // Parse body
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Bad Request' }); return; }

  // Daily limit (TICKET-049: reasoning mode gets reduced limit)
  const allowed = await checkAndIncrementLimit(uid, parsed.data.responseLength);
  if (!allowed) { res.status(429).json({ error: 'DAILY_LIMIT' }); return; }

  const { personaId, customSystemPrompt, messages, documentContent, documentMood, userPortrait, responseLength } = parsed.data;

  // Injection guard for custom prompts
  if (personaId === 'custom' && customSystemPrompt) {
    if (INJECTION_PATTERNS.some(p => p.test(customSystemPrompt))) {
      res.status(400).json({ error: 'Bad Request' }); return;
    }
  }

  // Injection guard for user messages
  const userMessages = messages.filter(m => m.role === 'user');
  if (userMessages.some(m => INJECTION_PATTERNS.some(p => p.test(m.content)))) {
    res.status(400).json({ error: 'Bad Request' }); return;
  }

  let systemPrompt = buildChatSystemPrompt({ personaId, customSystemPrompt, userPortrait, responseLength, documentContent: documentContent ? sanitizeAiInput(documentContent) : undefined, documentMood: documentMood ? sanitizeAiInput(documentMood) : undefined });

  // OPT-5: Context is now in system prompt, no fake user/assistant turn
  const providerMessages = messages.map(m => ({ role: m.role, content: sanitizeAiInput(m.content) }));

  // Stream. maxOutputTokens caps total output INCLUDING gemini-2.5 thinking tokens;
  // at 1024 the thinking budget could consume it all and truncate the reply
  // mid-sentence. 8192 leaves ample room for a complete answer.
  const [activeModel, chatModel] = await Promise.all([getActiveModel(), getChatModel()]);

  // RSN: reasoning mode. DeepSeek v4 Pro on Fireworks emits its chain-of-thought
  // in the native `reasoning_content` delta channel (confirmed: ~1.7k chars/turn),
  // which @ai-sdk/openai drops. We stream Fireworks directly to surface it and
  // synthesize the "ХОД МЫСЛИ:/ОТВЕТ:" markers the client parser expects.
  // IMPORTANT: build the prompt WITHOUT the marker instruction (as 'detailed') —
  // if we ask the model to also print the markers, it duplicates them into
  // `content` and the output gets garbled. The native channel is the source.
  if (AI_PROVIDER === 'fireworks' && responseLength === 'reasoning') {
    const baseReasoningSystem = buildChatSystemPrompt({ personaId, customSystemPrompt, userPortrait, responseLength: 'detailed', documentContent: documentContent ? sanitizeAiInput(documentContent) : undefined, documentMood: documentMood ? sanitizeAiInput(documentMood) : undefined });
    // DeepSeek tends to reason internally in Chinese; force the chain-of-thought
    // (reasoning_content) into Russian so the visible "ход мысли" is readable.
    const reasoningSystem = `${baseReasoningSystem}\n\nВАЖНО: и внутренние рассуждения (chain-of-thought / reasoning), и финальный ответ веди ТОЛЬКО на русском языке.`;
    await streamFireworksReasoning(res, uid, activeModel, reasoningSystem, providerMessages);
    return;
  }

  const result = streamText({
    model: chatModel,
    system: systemPrompt,
    messages: providerMessages,
    maxOutputTokens: responseLength === 'reasoning' ? 16384 : 8192,
    onFinish: async ({ totalUsage }) => {
      try {
        await recordUsage(uid, totalUsage?.inputTokens ?? 0, totalUsage?.outputTokens ?? 0, activeModel);
      } catch (e) {
        console.error('[api/chat] usage record failed:', e);
      }
    },
  });

  result.pipeTextStreamToResponse(res);
}
