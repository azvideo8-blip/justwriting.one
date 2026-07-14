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

export async function generate(params: GenerateParams): Promise<GenerateResult> {
  return generateOpenRouter(params);
}

async function generateOpenRouter(params: GenerateParams): Promise<GenerateResult> {
  const { system, messages, maxTokens, abortMs } = params;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const activeModel = params.model ?? await getActiveModel();

  const oaMessages: { role: string; content: string }[] = [];
  if (system) oaMessages.push({ role: 'system', content: system });
  for (const m of messages) oaMessages.push({ role: m.role, content: m.content });

  const body: Record<string, unknown> = {
    model: activeModel,
    messages: oaMessages,
    max_tokens: maxTokens ?? 4096,
  };
  // NOTE: response_format:{type:'json_object'} is intentionally never sent —
  // confirmed via live testing that OpenRouter's free gpt-oss-20b route
  // returns an empty content field when combined with json_object, even
  // though finish_reason is "stop" (not a truncation). Callers already
  // instruct strict JSON in their system prompts and repair truncated output.
  // gpt-oss models mandate a reasoning pass they can't skip; keep it on low
  // effort so it stays a few tokens instead of eating the max_tokens budget
  // before any content is written (see docs/reasoning-mode.md history).
  if (activeModel.startsWith('openai/gpt-oss')) body.reasoning = { effort: 'low' };

  // Retry transient upstream errors (502/503/504) with a short backoff —
  // OpenRouter's routed providers occasionally return these.
  const MAX_ATTEMPTS = 3;
  let res!: Response;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), abortMs ?? 110_000);
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
    } finally {
      clearTimeout(timeout);
    }

    if (res.ok) break;

    const transient = res.status === 502 || res.status === 503 || res.status === 504;
    if (transient && attempt < MAX_ATTEMPTS) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[aiProvider] attempt ${attempt} transient ${res.status}: ${errBody.slice(0, 200)}`);
      await new Promise(r => setTimeout(r, 500 * attempt));
      continue;
    }
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
  }

  // fetch() resolves as soon as the HEADERS arrive; for a non-streaming
  // completion the body only lands once the model has finished generating.
  // So this timer bounds the whole generation, not a slow socket — 30s was
  // far too tight and timed out every long chat/summary. Give it the same
  // budget as the request itself.
  let jsonTimerId: ReturnType<typeof setTimeout>;
  const jsonTimeout = new Promise<never>((_, reject) => {
    jsonTimerId = setTimeout(() => reject(new Error('body read timeout')), abortMs ?? 110_000);
  });
  const data = await Promise.race([
    res.json().finally(() => clearTimeout(jsonTimerId!)),
    jsonTimeout,
  ]) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  // Reasoning (when requested) lands in a separate `reasoning` field which we
  // intentionally drop here — only the final answer in `content` is returned.
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let res: Response;
  try {
    // No `dimensions` override — OpenRouter's embeddings endpoint doesn't
    // document support for truncating output size, so we take the model's
    // native dimension (Qwen3 Embedding 8B: 4096) and store whatever comes
    // back; embeddingIndexer.ts freshness-checks on (model, dim) so this is
    // safe to change.
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
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter embed ${res.status}: ${errText.slice(0, 300)}`);
  }

  let jsonTimerId: ReturnType<typeof setTimeout>;
  const jsonTimeout = new Promise<never>((_, reject) => {
    jsonTimerId = setTimeout(() => reject(new Error('body read timeout')), 30_000);
  });
  const data = await Promise.race([
    res.json().finally(() => clearTimeout(jsonTimerId!)),
    jsonTimeout,
  ]) as {
    data?: { embedding?: number[] }[];
    usage?: { total_tokens?: number };
  };

  const vectors = data.data?.map(d => d.embedding ?? []) ?? [];
  const dim = vectors[0]?.length ?? 0;
  const tokens = data.usage?.total_tokens ?? 0;
  return { vectors, model: OPENROUTER_EMBED_MODEL, dim, tokens };
}
