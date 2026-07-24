// OpenRouter is the sole AI provider.
const ACTIVE_CHAT_MODEL = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-flash';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL ?? 'qwen/qwen3-embedding-8b';

export async function getActiveModel(): Promise<string> {
  return ACTIVE_CHAT_MODEL;
}

export type ProviderRole = 'user' | 'assistant';
export interface ProviderMessage {
  role: ProviderRole;
  content: string;
}

export interface GenerateParams {
  system?: string | undefined;
  messages: ProviderMessage[];
  json?: boolean;
  maxTokens?: number;
  abortMs?: number;
  /** Override the OpenRouter model for this call (e.g. an obedient non-reasoning
   *  model for structured tasks). Defaults to the active chat model. */
  model?: string | undefined;
}

export interface GenerateResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  /** The model string actually used for this request (e.g. for recordUsage). */
  model: string;
}

export function isTransientError(err: unknown, didTimeout = false): boolean {
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

  const oaMessages: { role: string; content: string }[] = [];
  if (system) oaMessages.push({ role: 'system', content: system });
  for (const m of messages) oaMessages.push({ role: m.role, content: m.content });

  const body: Record<string, unknown> = {
    model: activeModel,
    messages: oaMessages,
    max_tokens: maxTokens ?? 4096,
  };

  if (activeModel.startsWith('openai/gpt-oss')) body.reasoning = { effort: 'low' };

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
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[aiProvider] attempt ${attempt} transient network error: ${errMsg}`);
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
        const errBody = await res.text().catch(() => '');
        console.warn(`[aiProvider] attempt ${attempt} transient ${res.status}: ${errBody.slice(0, 200)}`);
        await new Promise(r => setTimeout(r, 500 * attempt));
        continue;
      }
    }

    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
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
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content ?? '';
  return {
    text,
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
    model: activeModel,
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
      res = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENROUTER_EMBED_MODEL,
          input: texts,
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
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[aiProvider embed] attempt ${attempt} transient network error: ${errMsg}`);
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
        const errBody = await res.text().catch(() => '');
        console.warn(`[aiProvider embed] attempt ${attempt} transient ${res.status}: ${errBody.slice(0, 200)}`);
        await new Promise(r => setTimeout(r, 500 * attempt));
        continue;
      }
    }

    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter embed ${res.status}: ${errText.slice(0, 300)}`);
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
