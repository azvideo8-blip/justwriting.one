import type { IncomingMessage, ServerResponse } from 'node:http';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { requireSession } from './auth';
import { postgresAiContext } from './postgresAiContext';
import { hasInjectionAttempt } from '../src/shared/ai/injectionPatterns.js';
import { buildChatSystemPrompt, sanitizeAiInputShared } from '../src/shared/ai/buildChatPrompt.js';
import { validateInternalCallRestrictions, getMaxTokens } from '../src/shared/ai/aiPolicy.js';
import type { GlobalReservation } from './ai/context';

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, maxBytes = 4 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

const AI_BASE_URL = process.env.AI_BASE_URL ?? 'https://routerai.ru/api/v1';
const ACTIVE_CHAT_MODEL = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-flash';
export const AI_PROVIDER_COUNTRY = process.env.AI_PROVIDER_COUNTRY ?? '';
const providerRouting = AI_PROVIDER_COUNTRY ? { country: AI_PROVIDER_COUNTRY } : undefined;

/**
 * AI-1: Reasoning effort for chat mode.
 * Measured on deepseek/deepseek-v4-flash via RouterAI (scripts/ai-bench/reasoning-bench.mjs, 2026-08-20):
 * - effort: 'high'   -> 16342 chars deliberation, 5695 chars answer, 7252 tokens, 69.7 s
 * - effort: 'medium' ->  8617 chars deliberation, 6019 chars answer, 4547 tokens, 44.0 s
 * - effort: 'low'    ->  1737 chars deliberation, 4523 chars answer, 2017 tokens, 21.0 s (3.6x cheaper, 3.3x faster)
 * - effort: 'none'   ->     0 chars deliberation, 4651 chars answer, 1591 tokens, 17.0 s
 *
 * `low` provides a concise visible chain of thought while avoiding the massive token and latency inflation of `high`.
 *
 * IMPORTANT: Do NOT confuse this with the generate() path in api/ai/provider.ts!
 * In generate(), the baseline request had no reasoning parameter (~61 tokens), where reasoning_effort: 'none' is correct.
 * Here in chat, the mode is explicitly enabled by the user and the baseline was 'high'. Setting effort: 'low' cuts
 * deliberation tokens by ~90% while still streaming a chain of thought to the user.
 * Re-measure if changing models.
 */
export const CHAT_REASONING_EFFORT = 'low';

const ruOnlyFetch: typeof fetch = async (input, init) => {
  if (typeof init?.body === 'string') {
    try {
      const parsed: unknown = JSON.parse(init.body);
      if (providerRouting && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        init = { ...init, body: JSON.stringify({ ...parsed, provider: providerRouting }) };
      }
    } catch { /* не JSON — отдаём как есть */ }
  }
  return fetch(input, init);
};

const openrouterOptions: { baseURL: string; apiKey?: string; fetch?: typeof fetch } = {
  baseURL: AI_BASE_URL,
  fetch: ruOnlyFetch,
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

function sanitizeAiInput(content: string): string {
  return sanitizeAiInputShared(content);
}

type OrDelta = { reasoning_content?: string; reasoning?: string; content?: string };
type OrChunk = {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  choices?: Array<{ delta?: OrDelta }>;
};

async function streamOpenRouterReasoning(
  res: ServerResponse,
  uid: string,
  model: string,
  system: string,
  messages: Array<{ role: string; content: string }>,
  isInternalCall: boolean,
  reservation: GlobalReservation | null,
): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    await postgresAiContext.refundGlobalRequest(reservation);
    if (isInternalCall) {
      await postgresAiContext.refundBulkLimit(uid);
    } else {
      await postgresAiContext.refundDailyLimit(uid);
    }
    console.error('OPENROUTER_API_KEY not set');
    json(res, 500, { error: 'Internal server error' });
    return;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);
  let upstream: Response;
  try {
    upstream = await fetch(`${AI_BASE_URL}/chat/completions`, {
      signal: controller.signal,
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
        ...(providerRouting ? { provider: providerRouting } : {}),
        reasoning: { effort: CHAT_REASONING_EFFORT },
        stream_options: { include_usage: true },
      }),
    });
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[api/chat] upstream request failed:', err);
    await postgresAiContext.refundGlobalRequest(reservation);
    if (isInternalCall) {
      await postgresAiContext.refundBulkLimit(uid);
    } else {
      await postgresAiContext.refundDailyLimit(uid);
    }
    res.writeHead(504, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('UPSTREAM_TIMEOUT');
    return;
  }

  if (!upstream.ok || !upstream.body) {
    await postgresAiContext.refundGlobalRequest(reservation);
    if (isInternalCall) {
      await postgresAiContext.refundBulkLimit(uid);
    } else {
      await postgresAiContext.refundDailyLimit(uid);
    }
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('UPSTREAM_ERROR');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let wroteReasoningHeader = false;
  let wroteAnswerHeader = false;
  let tokensIn = 0;
  let tokensOut = 0;
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
            if (!wroteAnswerHeader) {
              if (wroteReasoningHeader) res.write('\n\nОТВЕТ:\n');
              wroteAnswerHeader = true;
            }
            res.write(content);
          } else {
            contentAccum += content;
            const answerMarkerRe = /^ОТВЕТ:\s*$/im;
            const markerMatch = contentAccum.match(answerMarkerRe);
            if (markerMatch && !wroteAnswerHeader) {
              const markerIdx = markerMatch.index ?? 0;
              const beforeMarker = contentAccum.slice(0, markerIdx).trim();
              const afterMarker = contentAccum.slice(markerIdx).replace(answerMarkerRe, '').trim();
              if (beforeMarker) {
                if (!wroteReasoningHeader) { res.write('ХОД МЫСЛИ:\n'); wroteReasoningHeader = true; }
                res.write(beforeMarker);
              }
              if (!wroteAnswerHeader) {
                if (wroteReasoningHeader) res.write('\n\nОТВЕТ:\n');
                wroteAnswerHeader = true;
              }
              res.write(afterMarker);
            } else if (!wroteAnswerHeader) {
              if (contentAccum.length > 2000 && !wroteReasoningHeader) {
                if (!wroteAnswerHeader) {
                  wroteAnswerHeader = true;
                }
                res.write(contentAccum);
                contentAccum = '';
              }
            } else {
              res.write(content);
            }
          }
        }
      }
    }
  } catch (streamErr) {
    console.error('[api/chat] stream read failed:', streamErr);
    await postgresAiContext.refundGlobalRequest(reservation);
    if (isInternalCall) {
      await postgresAiContext.refundBulkLimit(uid);
    } else {
      await postgresAiContext.refundDailyLimit(uid);
    }
  }

  if (contentAccum && !wroteAnswerHeader) {
    if (wroteReasoningHeader) { res.write('\n\nОТВЕТ:\n'); }
    wroteAnswerHeader = true;
    res.write(contentAccum);
  }
  try {
    await postgresAiContext.recordUsage(uid, tokensIn, tokensOut, { model, fn: 'chat-stream' }, reservation);
  } catch (e) {
    console.error('[api/chat] usage record failed:', e);
  }
  res.end();
}

const inputSchema = z.object({
  personaId: z.enum(['group_psychology', 'cbt', 'coach', 'editor', 'parts', 'custom']),
  customSystemPrompt: z.string().max(500).nullish(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(50_000),
  })).max(100).refine(
    msgs => msgs.reduce((sum, m) => sum + m.content.length, 0) <= 200_000,
    'Total messages content exceeds 200K characters',
  ),
  documentContent: z.string().max(50_000).nullish(),
  documentMood: z.string().max(50).nullish(),
  userPortrait: z.string().max(10_000).nullish(),
  memoryContext: z.string().max(20_000).nullish(),
  responseLength: z.enum(['short', 'standard', 'detailed']).nullish(),
  reasoning: z.boolean().nullish(),
  callType: z.enum(['auto_name', 'follow_up', 'query_expand']).nullish(),
});

export async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  const session = await requireSession(req);
  if (!session || !session.uid) {
    return json(res, 401, { error: 'Unauthorized' });
  }
  const uid = session.uid;

  let body: unknown;
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      return json(res, 413, { error: 'Payload too large' });
    }
    return json(res, 400, { error: 'Bad Request' });
  }

  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return json(res, 400, { error: 'Bad Request' });
  }

  let isInternalCall = false;
  try {
    const policyResult = validateInternalCallRestrictions({
      callType: parsed.data.callType,
      personaId: parsed.data.personaId,
      reasoning: parsed.data.reasoning,
      documentContent: parsed.data.documentContent,
      userPortrait: parsed.data.userPortrait,
      messages: parsed.data.messages,
    });
    isInternalCall = policyResult.isInternal;
  } catch {
    return json(res, 400, { error: 'Bad Request' });
  }

  if (isInternalCall) {
    const allowed = await postgresAiContext.checkAndIncrementBulkLimit(uid);
    if (!allowed) { return json(res, 429, { error: 'DAILY_LIMIT' }); }
  } else {
    const limitResult = await postgresAiContext.checkAndIncrementLimit(uid, parsed.data.reasoning === true);
    if (limitResult === 'DAILY_LIMIT') {
      return json(res, 429, { error: 'DAILY_LIMIT' });
    }
    if (limitResult === 'RATE_LIMIT') {
      return json(res, 429, { error: 'RATE_LIMIT' });
    }
  }

  const maxOutputTokens = getMaxTokens(isInternalCall, parsed.data.reasoning);
  const reservation = await postgresAiContext.tryReserveGlobalRequest(maxOutputTokens);
  if (!reservation) {
    if (isInternalCall) {
      await postgresAiContext.refundBulkLimit(uid);
    } else {
      await postgresAiContext.refundDailyLimit(uid);
    }
    return json(res, 429, { error: 'GLOBAL_LIMIT' });
  }

  const { personaId, customSystemPrompt, messages, documentContent, documentMood, userPortrait, memoryContext, responseLength, reasoning } = parsed.data;

  // Injection guards
  if (personaId === 'custom' && customSystemPrompt && hasInjectionAttempt(customSystemPrompt)) {
    await postgresAiContext.refundDailyLimit(uid);
    await postgresAiContext.refundGlobalRequest(reservation);
    return json(res, 400, { error: 'Bad Request' });
  }

  if (
    messages.some(m => hasInjectionAttempt(m.content)) ||
    (documentContent && hasInjectionAttempt(documentContent)) ||
    (memoryContext && hasInjectionAttempt(memoryContext)) ||
    (userPortrait && hasInjectionAttempt(userPortrait)) ||
    (documentMood && hasInjectionAttempt(documentMood))
  ) {
    if (isInternalCall) await postgresAiContext.refundBulkLimit(uid);
    else await postgresAiContext.refundDailyLimit(uid);
    await postgresAiContext.refundGlobalRequest(reservation);
    return json(res, 400, { error: 'Bad Request' });
  }

  const sanitizedCustomPrompt = customSystemPrompt ? sanitizeAiInput(customSystemPrompt) : undefined;
  const sanitizedPortrait = userPortrait ? sanitizeAiInput(userPortrait) : undefined;
  const sanitizedMemory = memoryContext ? sanitizeAiInput(memoryContext) : undefined;
  const providerMessages = messages.map(m => ({ role: m.role, content: sanitizeAiInput(m.content) }));

  const [activeModel, chatModel] = await Promise.all([getActiveModel(), getChatModel()]);

  if (reasoning) {
    const baseReasoningSystem = buildChatSystemPrompt({
      personaId,
      customSystemPrompt: sanitizedCustomPrompt,
      userPortrait: sanitizedPortrait,
      responseLength: responseLength ?? 'detailed',
      documentContent: documentContent ? sanitizeAiInput(documentContent) : undefined,
      documentMood: documentMood ? sanitizeAiInput(documentMood) : undefined,
    });
    const reasoningSystem = `${baseReasoningSystem}\n\nВАЖНО: и внутренние рассуждения (chain-of-thought / reasoning), и финальный ответ веди ТОЛЬКО на русском языке. Никогда не думай на английском или китайском.`;
    const reasoningMessages = providerMessages.map((m, i) =>
      i === providerMessages.length - 1 && m.role === 'user'
        ? { ...m, content: `${m.content}\n\n(Думай по-русски и ответь по-русски.)` }
        : m,
    );
    await streamOpenRouterReasoning(res, uid, activeModel, reasoningSystem, reasoningMessages, isInternalCall, reservation);
    return;
  }

  const systemPrompt = buildChatSystemPrompt({
    personaId,
    customSystemPrompt: sanitizedCustomPrompt,
    userPortrait: sanitizedPortrait,
    memoryContext: sanitizedMemory,
    responseLength,
    reasoning,
    documentContent: documentContent ? sanitizeAiInput(documentContent) : undefined,
    documentMood: documentMood ? sanitizeAiInput(documentMood) : undefined,
  });

  const result = streamText({
    model: chatModel,
    system: systemPrompt,
    messages: providerMessages,
    maxOutputTokens,
    providerOptions: { openai: { reasoningEffort: 'none' } },
    onFinish: async ({ totalUsage }) => {
      try {
        await postgresAiContext.recordUsage(
          uid,
          totalUsage?.inputTokens ?? 0,
          totalUsage?.outputTokens ?? 0,
          { model: activeModel, fn: 'chat-stream' },
          reservation,
        );
      } catch (e) {
        console.error('[api/chat] usage record failed:', e);
      }
    },
    onError: async (e) => {
      console.error('[api/chat] streamText failed:', e);
      await postgresAiContext.refundGlobalRequest(reservation);
      if (isInternalCall) {
        await postgresAiContext.refundBulkLimit(uid);
      } else {
        await postgresAiContext.refundDailyLimit(uid);
      }
    },
  });

  try {
    result.pipeTextStreamToResponse(res);
  } catch (streamErr) {
    console.error('[api/chat] pipe failed:', streamErr);
    await postgresAiContext.refundGlobalRequest(reservation);
    if (isInternalCall) {
      await postgresAiContext.refundBulkLimit(uid);
    } else {
      await postgresAiContext.refundDailyLimit(uid);
    }
    if (!res.headersSent) json(res, 500, { error: 'Stream failed' });
  }
}

export default handleChat;
