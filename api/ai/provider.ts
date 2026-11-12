// SA-8: тело запроса строится в одном месте — `src/shared/ai/requestConfig.ts`,
// тот же модуль импортируют харнесы из scripts/. Здесь от env остаются только
// снимки на старте процесса.
import {
  buildChatRequestBody,
  type ChatMessage,
  resolveChatBaseUrl,
  resolveChatModel,
  resolveProviderRouting,
} from '../../src/shared/ai/requestConfig.js';
import { safeErrorShape } from '../../src/shared/ai/errorShape.js';

// RouterAI is the sole AI provider: an OpenAI-compatible gateway, billed in
// roubles and reachable from Russia (OpenRouter is not). The wire format is
// unchanged, so only the base URL moves.
//
// ponytail: the OPENROUTER_* env names are kept as-is. They are bound by name in
// twelve `secrets: ['OPENROUTER_API_KEY']` declarations across functions/src/ai/*,
// and renaming a Firebase secret means re-setting and redeploying every one of
// them — on a Firebase deployment that the VPS migration retires. The VPS AI
// proxy gets provider-neutral AI_* names instead.
const ACTIVE_CHAT_MODEL = resolveChatModel();
// Ограничение контура обработки. Пусто = ограничения нет, запрос может уйти к
// зарубежному провайдеру модели (ст. 12 152-ФЗ). Проверено 2026-09-20:
// эмбеддинги теперь локальные и игнорируют флаг (проверено живьём); включение
// упирается в смену модели на `yandex/*` для всех вызывающих, так как
// `deepseek/deepseek-v4-flash` под `country: 'ru'` недоступен. См. api/chat.ts и
// docs/audit-2026-09-20-outbound-pii.md (OUT-1).
const PROVIDER_ROUTING = resolveProviderRouting();

const OPENROUTER_BASE_URL = resolveChatBaseUrl();
const OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL ?? 'qwen/qwen3-embedding-8b';
// Embeddings can point at a separate (e.g. local) server without moving chat
// off RouterAI — AI_BASE_URL is shared with generateOpenRouter() and api/chat.ts.
// Ревью Qoder 0.11.10 (C): тексты согласия обещают, что векторы считаются на сервере
// justwriting. На проде без AI_EMBED_BASE_URL векторы не считаются вовсе — отказ,
// а не тихий уход к общему провайдеру; /ready при этом «не готов».
const EMBED_BASE_URL: string | null = process.env.AI_EMBED_BASE_URL
  // ['NODE_ENV'] — во время работы, а не подстановкой сборщика.
  ?? (process.env['NODE_ENV'] === 'production' ? null : OPENROUTER_BASE_URL);

async function getActiveModel(): Promise<string> {
  return ACTIVE_CHAT_MODEL;
}

/**
 * R7Q-016: из тела отказа наружу не уходит ни байт — 4xx/5xx провайдера эхом
 * возвращают фрагмент отправленного запроса (текст заметки, портрет, память,
 * реплики диалога), а `Error.message` печатают шесть внутренних логик.
 * Единственное служебное, что по телю различают, — отказ по квоте: он остаётся
 * словом `quota` в сообщении, и regexp'ы логик продолжают срабатывать.
 */
const QUOTA_HINT_RE = /spending cap|quota|resource_exhausted|exceeded|too many requests/i;
const quotaHint = (errBody: string): string => (QUOTA_HINT_RE.test(errBody) ? ' quota' : '');

export interface GenerateParams {
  system?: string | undefined;
  messages: ChatMessage[];
  maxTokens?: number;
  abortMs?: number;
  /** Override the OpenRouter model for this call (e.g. an obedient non-reasoning
   *  model for structured tasks). Defaults to the active chat model. */
  model?: string | undefined;
  /** Turn provider-side reasoning on (chat reasoning mode). Omitted = none. */
  reasoningEffort?: 'low' | 'medium' | 'high' | undefined;
}

export interface GenerateResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  /** The model string actually used for this request (e.g. for recordUsage). */
  model: string;
  /** Provider-side reasoning text, when reasoningEffort was set. */
  reasoning?: string;
  /**
   * DT-1 (дейлик 04.11): `finish_reason` поставщика. Без него запасной путь
   * решает об обрыве только по счётчику токенов и не видит `length`, когда
   * поставщик недосчитал выдачу. null — сигнала не приходило.
   */
  finishReason?: string | null | undefined;
}

function isTransientError(err: unknown, didTimeout = false): boolean {
  if (didTimeout) return false;
  if (!err) return false;

  const msg = err instanceof Error ? err.message : String(err);
  const causeMsg =
    err instanceof Error && err.cause
      ? err.cause instanceof Error
        ? err.cause.message
        : String(err.cause)
      : '';
  const fullText = `${msg} ${causeMsg}`;

  const patterns = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EPIPE',
    'terminated',
    'socket hang up',
    'fetch failed',
  ];

  return patterns.some(p => fullText.includes(p));
}

export async function generate(params: GenerateParams): Promise<GenerateResult> {
  return generateOpenRouter(params);
}

async function generateOpenRouter(params: GenerateParams): Promise<GenerateResult> {
  const { system, messages, maxTokens, abortMs } = params;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const activeModel = params.model ?? (await getActiveModel());

  const body = buildChatRequestBody({
    system,
    messages,
    model: activeModel,
    maxTokens,
    reasoningEffort: params.reasoningEffort,
  });

  // Почему тело строится не здесь, а в src/shared/ai/requestConfig.ts: те же
  // поля обязаны быть у харнесов из scripts/, иначе замер измеряет конфигурацию,
  // которой нет в проде. Правило `reasoning_effort: 'none'` (и отказ от
  // `temperature`) выверено на живом RouterAI и описано там же.

  // Retry transient upstream errors (502/503/504 and network errors like ECONNRESET)
  // with a short backoff while respecting an overall time deadline.
  const MAX_ATTEMPTS = 3;
  const totalAbortMs = abortMs ?? 110_000;
  const deadline = Date.now() + totalAbortMs;
  const MIN_REMAINING_MS = 10_000;

  let res!: Response;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remainingMs = deadline - Date.now();
    if (attempt > 1 && remainingMs < MIN_REMAINING_MS) {
      console.warn(
        `[aiProvider] skipping retry attempt ${attempt}: insufficient remaining budget (${remainingMs}ms)`
      );
      if (lastError) throw lastError;
      break;
    }

    const perAttemptTimeoutMs = Math.min(totalAbortMs, Math.max(1, remainingMs));
    const controller = new AbortController();
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, perAttemptTimeoutMs);

    try {
      res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      lastError = err;
      if (didTimeout) {
        throw err;
      }

      const isTransient = isTransientError(err, didTimeout);
      if (isTransient && attempt < MAX_ATTEMPTS) {
        const remainingAfterErr = deadline - Date.now();
        if (remainingAfterErr >= MIN_REMAINING_MS) {
          // R7Q-016: сеть тоже печатается формой ошибки — сообщение fetch может нести фрагмент запроса.
          console.warn(`[aiProvider] attempt ${attempt} transient network error ${safeErrorShape(err)}`);
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }
      }

      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (res.ok) break;

    const transientStatus = res.status === 502 || res.status === 503 || res.status === 504;
    if (transientStatus && attempt < MAX_ATTEMPTS) {
      const remainingAfterErr = deadline - Date.now();
      if (remainingAfterErr >= MIN_REMAINING_MS) {
        // R7Q-016: тело читаем, чтобы освободить соединение, и тут же забываем —
        // в журнал уходит только статус. Текст отказа 4xx/5xx эхом возвращает
        // кусок отправленного запроса, то есть текст заметок человека.
        await res.text().catch(() => {});
        console.warn(`[aiProvider] attempt ${attempt} transient ${res.status}`);
        await new Promise(r => setTimeout(r, 500 * attempt));
        continue;
      }
    }

    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}${quotaHint(errBody)}`);
  }

  // fetch() resolves as soon as the HEADERS arrive; for a non-streaming
  // completion the body only lands once the model has finished generating.
  let jsonTimerId: ReturnType<typeof setTimeout>;
  const jsonTimeout = new Promise<never>((_, reject) => {
    jsonTimerId = setTimeout(() => reject(new Error('body read timeout')), totalAbortMs);
  });
  const data = (await Promise.race([
    res.json().finally(() => clearTimeout(jsonTimerId!)),
    jsonTimeout,
  ])) as {
    choices?: { message?: { content?: string; reasoning_content?: string; reasoning?: string }; finish_reason?: string | null }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const message = data.choices?.[0]?.message;
  const text = message?.content ?? '';
  const reasoning = message?.reasoning_content ?? message?.reasoning;
  const finishReason = data.choices?.[0]?.finish_reason ?? null;
  return {
    text,
    ...(reasoning ? { reasoning } : {}),
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
    model: activeModel,
    finishReason,
  };
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
  dim: number;
  tokens: number;
}

export async function embed(texts: string[]): Promise<EmbedResult> {
  return embedOpenRouter(texts);
}

async function embedOpenRouter(texts: string[]): Promise<EmbedResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
  if (!EMBED_BASE_URL) throw new Error('AI_EMBED_BASE_URL not set: embeddings refused in production');

  const MAX_ATTEMPTS = 3;
  const totalAbortMs = 60_000;
  const deadline = Date.now() + totalAbortMs;
  const MIN_REMAINING_MS = 10_000;

  let res!: Response;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remainingMs = deadline - Date.now();
    if (attempt > 1 && remainingMs < MIN_REMAINING_MS) {
      console.warn(
        `[aiProvider embed] skipping retry attempt ${attempt}: insufficient remaining budget (${remainingMs}ms)`
      );
      if (lastError) throw lastError;
      break;
    }

    const perAttemptTimeoutMs = Math.min(totalAbortMs, Math.max(1, remainingMs));
    const controller = new AbortController();
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, perAttemptTimeoutMs);

    try {
      res = await fetch(`${EMBED_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENROUTER_EMBED_MODEL,
          input: texts,
          ...(PROVIDER_ROUTING ? { provider: PROVIDER_ROUTING } : {}),
        }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      lastError = err;
      if (didTimeout) {
        throw err;
      }

      const isTransient = isTransientError(err, didTimeout);
      if (isTransient && attempt < MAX_ATTEMPTS) {
        const remainingAfterErr = deadline - Date.now();
        if (remainingAfterErr >= MIN_REMAINING_MS) {
          console.warn(`[aiProvider embed] attempt ${attempt} transient network error ${safeErrorShape(err)}`);
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }
      }

      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (res.ok) break;

    const transientStatus = res.status === 502 || res.status === 503 || res.status === 504;
    if (transientStatus && attempt < MAX_ATTEMPTS) {
      const remainingAfterErr = deadline - Date.now();
      if (remainingAfterErr >= MIN_REMAINING_MS) {
        await res.text().catch(() => {});   // R7Q-016: тело не печатается
        console.warn(`[aiProvider embed] attempt ${attempt} transient ${res.status}`);
        await new Promise(r => setTimeout(r, 500 * attempt));
        continue;
      }
    }

    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenRouter embed ${res.status}${quotaHint(errBody)}`);
  }

  let jsonTimerId: ReturnType<typeof setTimeout>;
  const jsonTimeout = new Promise<never>((_, reject) => {
    jsonTimerId = setTimeout(() => reject(new Error('body read timeout')), 30_000);
  });
  const data = (await Promise.race([
    res.json().finally(() => clearTimeout(jsonTimerId!)),
    jsonTimeout,
  ])) as {
    data?: { embedding?: number[] }[];
    usage?: { total_tokens?: number };
  };

  const vectors = data.data?.map(d => d.embedding ?? []) ?? [];
  const dim = vectors[0]?.length ?? 0;
  const tokens = data.usage?.total_tokens ?? 0;
  return { vectors, model: OPENROUTER_EMBED_MODEL, dim, tokens };
}
