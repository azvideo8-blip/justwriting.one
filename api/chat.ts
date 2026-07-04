import type { VercelRequest, VercelResponse } from '@vercel/node';
import { streamText } from 'ai';
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

// Project-wide daily request/token budget guard. Keep in sync with
// functions/src/shared/aiUtils.ts TIER_LIMITS.
const TIER_LIMITS = {
  requestsPerDay: envInt('AI_TIER_RPD', 10_000),
  tokensPerDay: envInt('AI_TIER_TPD', 25_000_000),
};

// Atomically check and reserve a slot in the project-wide daily cap.
// Prevents TOCTOU race where concurrent requests all pass the read check.
async function tryReserveGlobalRequest(): Promise<boolean> {
  const date = new Date().toISOString().slice(0, 10);
  const ref = db().doc(`aiGlobalDaily/${date}`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    const requests = d?.requests ?? 0;
    const tokens = (d?.promptTokens ?? 0) + (d?.completionTokens ?? 0);
    if (requests >= TIER_LIMITS.requestsPerDay || tokens >= TIER_LIMITS.tokensPerDay) return false;
    tx.set(ref, { requests: FieldValue.increment(1), date, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
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

// OpenRouter is the sole AI provider.
const ACTIVE_CHAT_MODEL = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-flash';
const openrouterOptions: { baseURL: string; apiKey?: string } = {
  baseURL: 'https://openrouter.ai/api/v1',
};
if (process.env.OPENROUTER_API_KEY) {
  openrouterOptions.apiKey = process.env.OPENROUTER_API_KEY;
}
const openrouter = createOpenAI(openrouterOptions);

async function getActiveModel(): Promise<string> {
  return ACTIVE_CHAT_MODEL;
}

async function getChatModel() {
  return openrouter.chat(ACTIVE_CHAT_MODEL);
}

// CHATFIX-6: buildSystemPrompt and sanitizeAiInput moved to shared module
// (src/shared/ai/buildChatPrompt.ts). Local wrappers kept for backwards compat.
function sanitizeAiInput(content: string): string {
  return sanitizeAiInputShared(content);
}

// Best-effort refund of one global daily request slot.
// Uses a transaction with date verification and Math.max(0, ...) clamping to
// prevent cross-day refunds and negative counts.
async function refundGlobalRequest(): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const fs = db();
  const ref = fs.doc(`aiGlobalDaily/${date}`);
  try {
    await fs.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data();
      if (!data || data.date !== date) return;
      tx.update(ref, { requests: Math.max(0, (data.requests ?? 0) - 1) });
    });
  } catch (e) {
    console.error('[api/chat] refundGlobalRequest failed:', e);
  }
}

// Best-effort refund of one per-user daily limit slot.
// Uses a transaction with date check and Math.max(0, ...) clamping to
// prevent cross-day refunds and negative counts.
async function refundDailyLimit(uid: string): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const fs = db();
  const ref = fs.doc(`aiDailyLimit/${uid}`);
  const cooldownRef = fs.doc(`aiCooldown/${uid}`);
  try {
    await fs.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data();
      if (!data || data.date !== date) return;
      tx.update(ref, { count: Math.max(0, (data.count ?? 0) - 1) });
      tx.delete(cooldownRef);
    });
  } catch (e) {
    console.error('[api/chat] refundDailyLimit failed:', e);
  }
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

// LX-2a: Admins get effectively no limit — skip checkAndIncrementLimit entirely.
async function isAdmin(uid: string): Promise<boolean> {
  try {
    const snap = await db().doc(`users/${uid}`).get();
    return snap.data()?.role === 'admin';
  } catch { return false; }
}

const COOLDOWN_MS = 10_000;

// LX-2a: Admins skip the per-user limit.
async function checkAndIncrementLimit(uid: string, reasoning?: boolean | null): Promise<boolean> {
  // Admins bypass the per-user limit
  if (await isAdmin(uid)) return true;

  const fs = db();
  const now = Date.now();
  const date = new Date().toISOString().slice(0, 10);
  const cooldownRef = fs.doc(`aiCooldown/${uid}`);
  const dailyRef = fs.doc(`aiDailyLimit/${uid}`);

  // TICKET-049: Reasoning mode gets reduced limit (5 instead of 10)
  const baseLimit = await userDailyLimit(uid);
  const limit = reasoning ? Math.min(baseLimit, 5) : baseLimit;

  return fs.runTransaction(async (tx) => {
    const [cooldownSnap, dailySnap] = await Promise.all([
      tx.get(cooldownRef),
      tx.get(dailyRef),
    ]);
    const cooldownData = cooldownSnap.data();
    if (cooldownData && now - cooldownData.lastRequestAt < COOLDOWN_MS) return false;
    const dailyData = dailySnap.data();
    if (dailyData && dailyData.date === date && dailyData.count >= limit) return false;
    tx.set(cooldownRef, { lastRequestAt: now }, { merge: true });
    if (!dailyData || dailyData.date !== date) {
      tx.set(dailyRef, { count: 1, date });
    } else {
      tx.update(dailyRef, { count: dailyData.count + 1 });
    }
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
  // Global doc: requests already incremented atomically by tryReserveGlobalRequest;
  // only add token counts here.
  batch.set(fs.doc(`aiGlobalDaily/${date}`), {
    date,
    promptTokens: FieldValue.increment(tokensIn),
    completionTokens: FieldValue.increment(tokensOut),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  // Per-request event for admin breakdown
  const eventRef = fs.collection(`aiUsage/${uid}/events`).doc();
  batch.set(eventRef, { date, ts: FieldValue.serverTimestamp(), tokensIn, tokensOut, model, fn: 'chat-stream' });
  await batch.commit();
}

// RSN: Reasoning mode. DeepSeek's chain-of-thought lands in the separate
// `reasoning` delta channel, which @ai-sdk/openai does NOT surface (it only
// maps OpenAI o-series reasoning summaries). So for reasoning mode we stream
// OpenRouter's /chat/completions directly, reading both channels and
// synthesizing the plain-text section markers the client parser expects
// ("ХОД МЫСЛИ:" / "ОТВЕТ:"). If the active model emits no reasoning, we just
// stream the answer (no empty reasoning section). OpenRouter only emits
// reasoning when explicitly requested via `reasoning: {effort}` — unlike
// Fireworks, which always emitted it for reasoning-capable models.
type OrDelta = { reasoning_content?: string; reasoning?: string; content?: string };
type OrChunk = {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  choices?: Array<{ delta?: OrDelta }>;
};
async function streamOpenRouterReasoning(
  res: VercelResponse,
  uid: string,
  model: string,
  system: string,
  messages: Array<{ role: string; content: string }>,
  isInternalCall: boolean,
): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    await refundGlobalRequest();
    if (!isInternalCall) await refundDailyLimit(uid);
    res.status(500).end('OPENROUTER_API_KEY not set');
    return;
  }
  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      stream: true,
      max_tokens: 16384,
      reasoning: { effort: 'high' },
      stream_options: { include_usage: true },
    }),
  });

  if (!upstream.ok || !upstream.body) {
    await refundGlobalRequest();
    if (!isInternalCall) await refundDailyLimit(uid);
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
   // LX-1: Accumulate content when no reasoning_content channel, to detect
  // inline "ОТВЕТ:" marker and relabel the preamble as "ХОД МЫСЛИ:".
   let contentAccum = '';
   let sawNativeReasoning = false;
 
   try {
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
      let chunk: OrChunk;
      try { chunk = JSON.parse(data) as OrChunk; } catch { continue; }
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens ?? tokensIn;
        tokensOut = chunk.usage.completion_tokens ?? tokensOut;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      const content = delta.content;
      if (reasoning) {
        sawNativeReasoning = true;
        if (!wroteReasoningHeader) { res.write('ХОД МЫСЛИ:\n'); wroteReasoningHeader = true; }
        res.write(reasoning);
      }
      if (content) {
        if (sawNativeReasoning) {
          // Normal path: native reasoning channel was used, content is the answer
          if (!wroteAnswerHeader) {
            if (wroteReasoningHeader) res.write('\n\nОТВЕТ:\n');
            wroteAnswerHeader = true;
          }
          res.write(content);
        } else {
          // LX-1: No native reasoning channel — check if content contains inline "ОТВЕТ:"
          contentAccum += content;
          // Check if we've hit the "ОТВЕТ:" marker on its own line
          const answerMarkerRe = /^ОТВЕТ:\s*$/im;
          const markerMatch = contentAccum.match(answerMarkerRe);
          if (markerMatch && !wroteAnswerHeader) {
            const markerIdx = markerMatch.index ?? 0;
            const beforeMarker = contentAccum.slice(0, markerIdx).trim();
            const afterMarker = contentAccum.slice(markerIdx).replace(answerMarkerRe, '').trim();
            // Emit preamble as reasoning
            if (beforeMarker) {
              if (!wroteReasoningHeader) { res.write('ХОД МЫСЛИ:\n'); wroteReasoningHeader = true; }
              res.write(beforeMarker);
            }
            // Emit answer
            if (!wroteAnswerHeader) {
              if (wroteReasoningHeader) res.write('\n\nОТВЕТ:\n');
              wroteAnswerHeader = true;
            }
            res.write(afterMarker);
          } else if (!wroteAnswerHeader) {
            // Haven't found marker yet — buffer and don't emit yet.
            // But if the accumulated content is short, just wait.
            // If it's getting long without a marker, emit as answer (fallback).
            if (contentAccum.length > 2000 && !wroteReasoningHeader) {
              // No marker found in first 2K chars — likely no inline leak, emit as answer
              if (!wroteAnswerHeader) {
                wroteAnswerHeader = true;
              }
              res.write(contentAccum);
              contentAccum = '';
            }
          } else {
            // Already in answer mode — emit content directly
            res.write(content);
          }
        }
      }
    }
   }
    } catch (streamErr) {
      console.error('[api/chat] stream read failed:', streamErr);
      await refundGlobalRequest();
      if (!isInternalCall) await refundDailyLimit(uid);
    }
   // LX-1: Flush any remaining buffered content (no marker was found)
  if (contentAccum && !wroteAnswerHeader) {
    if (wroteReasoningHeader) { res.write('\n\nОТВЕТ:\n'); }
    wroteAnswerHeader = true;
    res.write(contentAccum);
  }
  try {
    await recordUsage(uid, tokensIn, tokensOut, model);
  } catch (e) {
    console.error('[api/chat] usage record failed:', e);
  }
  res.end();
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
  responseLength: z.enum(['short', 'standard', 'detailed']).nullish(),
  reasoning: z.boolean().nullish(),
  callType: z.enum(['auto_name', 'follow_up', 'query_expand']).nullish(),
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

  // Parse body
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Bad Request' }); return; }

  // Internal call types (auto-naming, follow-up generation, query expansion) skip
  // the per-user daily limit and cooldown — they are background infrastructure.
  // The global guard (tryReserveGlobalRequest) still applies.
  // Internal calls are restricted: low maxTokens, no custom persona, no reasoning.
  const isInternalCall = parsed.data.callType !== undefined && parsed.data.callType !== null;

  if (isInternalCall) {
    if (parsed.data.personaId === 'custom') {
      res.status(400).json({ error: 'Bad Request' }); return;
    }
    if (parsed.data.reasoning === true) {
      res.status(400).json({ error: 'Bad Request' }); return;
    }
    if (parsed.data.documentContent || parsed.data.userPortrait) {
      res.status(400).json({ error: 'Bad Request' }); return;
    }
    if (parsed.data.messages.length > 3) {
      res.status(400).json({ error: 'Bad Request' }); return;
    }
  }

  // Daily limit first (LX-2a: admins skip; internal calls skip) — avoids wasting a global slot if user is at per-user cap
  if (!isInternalCall) {
    const allowed = await checkAndIncrementLimit(uid, parsed.data.reasoning);
    if (!allowed) { res.status(429).json({ error: 'DAILY_LIMIT' }); return; }
  }

  // Project-wide free-tier guard (across all users + resets)
  if (!(await tryReserveGlobalRequest())) {
    if (!isInternalCall) await refundDailyLimit(uid);
    res.status(429).json({ error: 'GLOBAL_LIMIT' }); return;
  }

  const { personaId, customSystemPrompt, messages, documentContent, documentMood, userPortrait, responseLength, reasoning } = parsed.data;

  // Injection guard for custom prompts
  if (personaId === 'custom' && customSystemPrompt) {
    if (INJECTION_PATTERNS.some(p => p.test(customSystemPrompt))) {
      await refundDailyLimit(uid); await refundGlobalRequest();
      res.status(400).json({ error: 'Bad Request' }); return;
    }
  }

  // S-3: Injection guard for ALL message turns (not just user) — a client-fabricated
  // assistant message is the real injection vector.
  if (messages.some(m => INJECTION_PATTERNS.some(p => p.test(m.content)))) {
    if (!isInternalCall) await refundDailyLimit(uid); await refundGlobalRequest();
    res.status(400).json({ error: 'Bad Request' }); return;
  }

  const sanitizedCustomPrompt = customSystemPrompt ? sanitizeAiInput(customSystemPrompt) : undefined;
  const sanitizedPortrait = userPortrait ? sanitizeAiInput(userPortrait) : undefined;
  let systemPrompt = buildChatSystemPrompt({ personaId, customSystemPrompt: sanitizedCustomPrompt, userPortrait: sanitizedPortrait, responseLength, reasoning, documentContent: documentContent ? sanitizeAiInput(documentContent) : undefined, documentMood: documentMood ? sanitizeAiInput(documentMood) : undefined });

  // OPT-5: Context is now in system prompt, no fake user/assistant turn
  const providerMessages = messages.map(m => ({ role: m.role, content: sanitizeAiInput(m.content) }));

  // Stream. maxOutputTokens caps total output INCLUDING thinking tokens;
  // at 1024 the thinking budget could consume it all and truncate the reply
  // mid-sentence. 8192 leaves ample room for a complete answer.
  const [activeModel, chatModel] = await Promise.all([getActiveModel(), getChatModel()]);

  // RSN: reasoning mode. DeepSeek v4 Pro on OpenRouter emits its chain-of-thought
  // in the `reasoning` delta channel when requested via reasoning:{effort},
  // which @ai-sdk/openai drops. We stream OpenRouter directly to surface it and
  // synthesize the "ХОД МЫСЛИ:/ОТВЕТ:" markers the client parser expects.
  // IMPORTANT: build the prompt WITHOUT the marker instruction (as 'detailed') —
  // if we ask the model to also print the markers, it duplicates them into
  // `content` and the output gets garbled. The native channel is the source.
  if (reasoning) {
    const baseReasoningSystem = buildChatSystemPrompt({ personaId, customSystemPrompt: sanitizedCustomPrompt, userPortrait: sanitizedPortrait, responseLength: responseLength ?? 'detailed', documentContent: documentContent ? sanitizeAiInput(documentContent) : undefined, documentMood: documentMood ? sanitizeAiInput(documentMood) : undefined });
    // DeepSeek tends to reason internally in Chinese; force the chain-of-thought
    // (reasoning_content) into Russian so the visible "ход мысли" is readable.
    const reasoningSystem = `${baseReasoningSystem}\n\nВАЖНО: и внутренние рассуждения (chain-of-thought / reasoning), и финальный ответ веди ТОЛЬКО на русском языке. Никогда не думай на английском или китайском.`;
    // DeepSeek follows a language directive in the latest USER turn far more
    // reliably than one in the system prompt — append it to the last user message.
    const reasoningMessages = providerMessages.map((m, i) =>
      i === providerMessages.length - 1 && m.role === 'user'
        ? { ...m, content: `${m.content}\n\n(Думай по-русски и ответь по-русски.)` }
        : m,
    );
    await streamOpenRouterReasoning(res, uid, activeModel, reasoningSystem, reasoningMessages, isInternalCall);
    return;
  }

  const maxOutputTokens = isInternalCall ? 256 : (reasoning ? 16384 : 8192);

  const result = streamText({
    model: chatModel,
    system: systemPrompt,
    messages: providerMessages,
    maxOutputTokens,
    onFinish: async ({ totalUsage }) => {
      try {
        await recordUsage(uid, totalUsage?.inputTokens ?? 0, totalUsage?.outputTokens ?? 0, activeModel);
      } catch (e) {
        console.error('[api/chat] usage record failed:', e);
      }
    },
    onError: async (e) => {
      console.error('[api/chat] streamText failed:', e);
      await refundGlobalRequest();
      if (!isInternalCall) await refundDailyLimit(uid);
    },
  });

  try {
    result.pipeTextStreamToResponse(res);
  } catch (streamErr) {
    console.error('[api/chat] pipe failed:', streamErr);
    await refundGlobalRequest();
    if (!isInternalCall) await refundDailyLimit(uid);
    if (!res.headersSent) res.status(500).json({ error: 'Stream failed' });
  }
}
