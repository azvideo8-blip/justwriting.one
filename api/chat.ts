import { sendError } from './sendError';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { requireSession } from './auth';
import { postgresAiContext } from './postgresAiContext';
import { buildChatSystemPrompt, sanitizeAiInputShared } from '../src/shared/ai/buildChatPrompt.js';
import { validateInternalCallRestrictions, getMaxTokens, estimateInputTokens, assertNoSystemPromptInjection } from '../src/shared/ai/aiPolicy.js';
import type { GlobalReservation } from '../src/shared/ai/context.js';
import { MAX_REQUEST_BODY_BYTES, MAX_AI_CONTENT_LENGTH } from './ai/pure';

// AUDIT-part3 2: все ответы ошибок ушли через sendError (единая форма
// {error:{code,message}}); локальный json-хелпер удалён как неиспользуемый.

function readBody(req: IncomingMessage, maxBytes = MAX_REQUEST_BODY_BYTES): Promise<string> {
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

async function getActiveModel(): Promise<string> {
  return ACTIVE_CHAT_MODEL;
}

async function getChatModel() {
  return createOpenAI({
    baseURL: AI_BASE_URL,
    ...(process.env.OPENROUTER_API_KEY ? { apiKey: process.env.OPENROUTER_API_KEY } : {}),
    fetch: ruOnlyFetch,
  }).chat(ACTIVE_CHAT_MODEL);
}

function sanitizeAiInput(content: string): string {
  return sanitizeAiInputShared(content);
}

type OrDelta = { reasoning_content?: string; reasoning?: string; content?: string };
type OrChunk = {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  choices?: Array<{ delta?: OrDelta }>;
};

interface Settlement {
  markUpstreamProduced: () => void;
  settle: (reason: 'closed' | 'failed' | 'done') => Promise<void>;
}

// Одно правило — одна реализация. Две ветки стрима уже разошлись однажды:
// AG-BILL-2 починил ветку рассуждений, а обычный чат остался без возврата на
// девять релизов, потому что чинить пришли в тот файл, где искали.
function createSettlement(
  uid: string,
  isInternalCall: boolean,
  reservation: GlobalReservation | null,
  chargedDay: string,
): Settlement {
  let upstreamProduced = false;
  let settled = false;
  return {
    markUpstreamProduced: () => {
      upstreamProduced = true;
    },
    settle: async (reason: 'closed' | 'failed' | 'done') => {
      if (settled) return;
      settled = true;
      if (reason === 'done') return;

      // DEEP-8: Выданные токены оплачены на самом деле — если модель уже начала
      // отвечать, сброс соединения клиентом не возвращает дневную квоту.
      // Возврат происходит только если апстрим ничего не успел выдать (!upstreamProduced).
      if (!upstreamProduced) {
        if (isInternalCall) {
          await postgresAiContext.refundBulkLimit(uid, chargedDay);
        } else {
          await postgresAiContext.refundDailyLimit(uid, chargedDay);
        }
        await postgresAiContext.refundGlobalRequest(reservation);
      }
    },
  };
}

async function streamOpenRouterReasoning(
  res: ServerResponse,
  uid: string,
  model: string,
  system: string,
  messages: Array<{ role: string; content: string }>,
  isInternalCall: boolean,
  reservation: GlobalReservation | null,
  chargedDay: string,
): Promise<void> {
  const settlement = createSettlement(uid, isInternalCall, reservation, chargedDay);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    await settlement.settle('failed');
    console.error('OPENROUTER_API_KEY not set');
    sendError(res, 500, 'INTERNAL');
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
    await settlement.settle('failed');
    sendError(res, 504, 'UPSTREAM_TIMEOUT', 'AI provider did not respond in time.');
    return;
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(timeoutId);
    await settlement.settle('failed');
    sendError(res, 502, 'UPSTREAM_ERROR', 'AI provider returned an error.');
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

  // Клиент ушёл до первого байта содержимого — слот не использован, возвращаем
  // его. AG-VERIFY-2 (находка 1, замер на проде 2026-08-23): флаг раньше
  // поднимался при первом куске ОТ ПОСТАВЩИКА — гонка между RST клиента и
  // первым токеном модели решалась в пользу списания, хотя комментарий
  // обещал гарантию. Теперь флаг означает ровно то, что написано: байт
  // реально поставлен в сокет ДО разрыва; запись в мёртвый сокет слот не
  // спасает. Гарантия действует на VPS: res.on('close') ненадёжен на
  // serverless-edge.
  // Запись в мёртвый сокет бессмысленна — не делаем её вовсе (AG-VERIFY-2).
  // Гарантия действует на VPS: res.on('close') ненадёжен на serverless-edge.
  const write = (s: string) => {
    if (!res.destroyed) res.write(s);
  };
  let sawUpstreamChunk = false;

  res.on('close', () => {
    controller.abort();
    void settlement.settle('closed');
  });

  let streamFailed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      settlement.markUpstreamProduced();
      sawUpstreamChunk = true;
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
          if (!wroteReasoningHeader) { write('ХОД МЫСЛИ:\n'); wroteReasoningHeader = true; }
          write(reasoning);
        }
        if (content) {
          if (sawNativeReasoning) {
            if (!wroteAnswerHeader) {
              if (wroteReasoningHeader) write('\n\nОТВЕТ:\n');
              wroteAnswerHeader = true;
            }
            write(content);
          } else {
            contentAccum += content;
            const answerMarkerRe = /^ОТВЕТ:\s*$/im;
            const markerMatch = contentAccum.match(answerMarkerRe);
            if (markerMatch && !wroteAnswerHeader) {
              const markerIdx = markerMatch.index ?? 0;
              const beforeMarker = contentAccum.slice(0, markerIdx).trim();
              const afterMarker = contentAccum.slice(markerIdx).replace(answerMarkerRe, '').trim();
              if (beforeMarker) {
                if (!wroteReasoningHeader) { write('ХОД МЫСЛИ:\n'); wroteReasoningHeader = true; }
                write(beforeMarker);
              }
              if (!wroteAnswerHeader) {
                if (wroteReasoningHeader) write('\n\nОТВЕТ:\n');
                wroteAnswerHeader = true;
              }
              write(afterMarker);
            } else if (!wroteAnswerHeader) {
              if (contentAccum.length > 2000 && !wroteReasoningHeader) {
                if (!wroteAnswerHeader) {
                  wroteAnswerHeader = true;
                }
                write(contentAccum);
                contentAccum = '';
              }
            } else {
              write(content);
            }
          }
        }
      }
    }
  } catch (streamErr) {
    console.error('[api/chat] stream read failed:', streamErr);
    streamFailed = true;
  }

  await settlement.settle(streamFailed ? 'failed' : 'done');

  if (contentAccum && !wroteAnswerHeader) {
    if (wroteReasoningHeader) { write('\n\nОТВЕТ:\n'); }
    wroteAnswerHeader = true;
    write(contentAccum);
  }
  // При полном провале (sawUpstreamChunk === false) не пишем строку usage:
  // токены нулевые, а requests+1 надувает счётчик запросов в статистике.
  if (!streamFailed || sawUpstreamChunk) {
    try {
      await postgresAiContext.recordUsage(uid, tokensIn, tokensOut, { model, fn: 'chat-stream' }, reservation);
    } catch (e) {
      console.error('[api/chat] usage record failed:', e);
    }
  }
  res.end();
}

const inputSchema = z.object({
  personaId: z.enum(['group_psychology', 'cbt', 'coach', 'editor', 'parts', 'custom']),
  customSystemPrompt: z.string().max(500).nullish(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(MAX_AI_CONTENT_LENGTH),
  })).max(100).refine(
    msgs => msgs.reduce((sum, m) => sum + m.content.length, 0) <= 200_000,
    'Total messages content exceeds 200K characters',
  ),
  documentContent: z.string().max(MAX_AI_CONTENT_LENGTH).nullish(),
  documentMood: z.string().max(50).nullish(),
  userPortrait: z.string().max(10_000).nullish(),
  memoryContext: z.string().max(20_000).nullish(),
  responseLength: z.enum(['short', 'standard', 'detailed']).nullish(),
  reasoning: z.boolean().nullish(),
  callType: z.enum(['auto_name', 'follow_up', 'query_expand']).nullish(),
});

export async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }

  const session = await requireSession(req);
  if (!session || !session.uid) {
    sendError(res, 401, 'AUTH_REQUIRED');
    return;
  }
  const uid = session.uid;

  // AUD-2: согласие проверяется здесь, а не в браузере — клиентский гейт
  // обходится прямым запросом, а именно этим путём и идёт основной чат.
  const consent = await postgresAiContext.getAiConsent(uid);
  if (!consent.granted) {
    sendError(res, 403, 'AI_CONSENT_REQUIRED');
    return;
  }

  let body: unknown;
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
      sendError(res, 413, 'PAYLOAD_TOO_LARGE');
    return;
    }
    sendError(res, 400, 'BAD_REQUEST');
    return;
  }

  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    sendError(res, 400, 'BAD_REQUEST');
    return;
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
    sendError(res, 400, 'BAD_REQUEST');
    return;
  }

  // День списания. Все refund'ы ниже целятся в него: запрос, начатый в
  // 23:58 и упавший после полуночи, возвращает единицу в правильную строку.
  let chargedDay: string;

  if (isInternalCall) {
    const verdict = await postgresAiContext.checkAndIncrementBulkLimit(uid, 'chat');
    if (verdict === 'RATE_LIMIT') { sendError(res, 429, 'RATE_LIMIT');
    return; }
    if (!verdict.ok) { sendError(res, 429, 'DAILY_LIMIT');
    return; }
    chargedDay = verdict.day;
  } else {
    const limitResult = await postgresAiContext.checkAndIncrementLimit(uid, parsed.data.reasoning === true);
    if (limitResult === 'DAILY_LIMIT') {
      sendError(res, 429, 'DAILY_LIMIT');
    return;
    }
    if (limitResult === 'RATE_LIMIT') {
      sendError(res, 429, 'RATE_LIMIT');
    return;
    }
    chargedDay = limitResult.day;
  }

  const maxOutputTokens = getMaxTokens(isInternalCall, parsed.data.reasoning);
  // AUD-19: в резерв закладываем и вход — длинная заметка стоит токенов так же,
  // как ответ; иначе потолок защищал меньше, чем обещал.
  const inputEstimate = estimateInputTokens([
    ...parsed.data.messages.map(m => m.content),
    parsed.data.documentContent, parsed.data.memoryContext,
    parsed.data.userPortrait, parsed.data.customSystemPrompt,
  ]);
  const reservation = await postgresAiContext.tryReserveGlobalRequest(maxOutputTokens + inputEstimate);
  if (!reservation) {
    if (isInternalCall) {
      await postgresAiContext.refundBulkLimit(uid, chargedDay);
    } else {
      await postgresAiContext.refundDailyLimit(uid, chargedDay);
    }
    sendError(res, 429, 'GLOBAL_LIMIT');
    return;
  }

  const { personaId, customSystemPrompt, messages, documentContent, documentMood, userPortrait, memoryContext, responseLength, reasoning } = parsed.data;

  // Injection guards (AUDIT-MH8: direct instructions only; note-derived fields are fenced and sanitized)
  try {
    assertNoSystemPromptInjection({
      messages,
      customSystemPrompt,
      personaId,
    });
  } catch {
    if (isInternalCall) await postgresAiContext.refundBulkLimit(uid, chargedDay);
    else await postgresAiContext.refundDailyLimit(uid, chargedDay);
    await postgresAiContext.refundGlobalRequest(reservation);
    sendError(res, 400, 'BAD_REQUEST');
    return;
  }

  const sanitizedCustomPrompt = customSystemPrompt ? sanitizeAiInput(customSystemPrompt) : undefined;
  const sanitizedPortrait = userPortrait ? sanitizeAiInput(userPortrait) : undefined;
  const sanitizedMemory = memoryContext ? sanitizeAiInput(memoryContext) : undefined;
  const providerMessages = messages.map(m => ({ role: m.role, content: sanitizeAiInput(m.content) }));

  const [activeModel, chatModel] = await Promise.all([getActiveModel(), getChatModel()]);

  // AG-MEM-1: Single shared prompt options builder. Prevents divergent argument lists
  // between the reasoning and non-reasoning paths so memory, persona, and document context
  // never quietly drop on one side.
  const basePromptParams = {
    personaId,
    customSystemPrompt: sanitizedCustomPrompt,
    userPortrait: sanitizedPortrait,
    memoryContext: sanitizedMemory,
    responseLength: responseLength ?? 'detailed',
    documentContent: documentContent ? sanitizeAiInput(documentContent) : undefined,
    documentMood: documentMood ? sanitizeAiInput(documentMood) : undefined,
  };

  if (reasoning) {
    // AG-MEM-1: OpenRouter reasoning uses native provider-side CoT via
    // `reasoning: { effort: CHAT_REASONING_EFFORT }` (line 167) rather than
    // in-band prompt-based CoT sections. We pass reasoning: false here so that
    // buildChatSystemPrompt suppresses in-band <reasoning> blocks, preventing
    // duplicate "ХОД МЫСЛИ:" headers and conflicts with the native reasoning stream.
    const baseReasoningSystem = buildChatSystemPrompt({
      ...basePromptParams,
      reasoning: false,
    });
    const reasoningSystem = `${baseReasoningSystem}\n\nВАЖНО: и внутренние рассуждения (chain-of-thought / reasoning), и финальный ответ веди ТОЛЬКО на русском языке. Никогда не думай на английском или китайском.`;
    const reasoningMessages = providerMessages.map((m, i) =>
      i === providerMessages.length - 1 && m.role === 'user'
        ? { ...m, content: `${m.content}\n\n(Думай по-русски и ответь по-русски.)` }
        : m,
    );
    await streamOpenRouterReasoning(res, uid, activeModel, reasoningSystem, reasoningMessages, isInternalCall, reservation, chargedDay);
    return;
  }

  const systemPrompt = buildChatSystemPrompt({
    ...basePromptParams,
    responseLength,
    reasoning: false,
  });

  const settlement = createSettlement(uid, isInternalCall, reservation, chargedDay);
  const controller = new AbortController();

  // Уход клиента: обрываем запрос к поставщику (иначе он досчитывает ответ,
  // который никто не прочитает) и возвращаем слот.
  res.on('close', () => {
    controller.abort();
    void settlement.settle('closed');
  });

  const result = streamText({
    model: chatModel,
    system: systemPrompt,
    messages: providerMessages,
    maxOutputTokens,
    abortSignal: controller.signal,
    providerOptions: { openai: { reasoningEffort: 'none' } },
    // Поставщик что-то выдал — это НЕ то же, что «байт дошёл до клиента».
    // Выданные токены потрачены и из глобального резерва не возвращаются.
    onChunk: () => { settlement.markUpstreamProduced(); },
    onFinish: async ({ totalUsage }) => {
      await settlement.settle('done'); // до записи расхода и до конца ответа
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
      await settlement.settle('failed');
    },
  });

  try {
    // Обёртка нужна из-за смены сигнатуры между версиями SDK: в ai@6.0.191
    // метод возвращает void, в следующей — промис. Голый await ругает линт
    // сегодня, а отсутствие await завтра пропустит сбой пайпа мимо этого
    // catch — то есть слот лимита перестанет возвращаться при обрыве стрима.
    // Promise.resolve одинаково верна для обеих сигнатур.
    await Promise.resolve(result.pipeTextStreamToResponse(res));
  } catch (streamErr) {
    console.error('[api/chat] pipe failed:', streamErr);
    await settlement.settle('failed');
    if (!res.headersSent) sendError(res, 500, 'STREAM_FAILED');
  }
}

export default handleChat;
