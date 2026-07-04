import { GEMINI_MODEL, getGenAI } from './aiUtils';
import { getDb } from './firestore';
import { FieldValue } from 'firebase-admin/firestore';

// Provider seam: lets the same call sites run against Gemini (Google) or an
// OpenRouter-hosted OpenAI-compatible model (e.g. DeepSeek). Switch via the
// AI_PROVIDER env var; Gemini stays available as a fallback.
export const AI_PROVIDER = (process.env.AI_PROVIDER ?? 'openrouter').toLowerCase();
// Env-var default for the OpenRouter model (used if Firestore config is absent).
const OPENROUTER_MODEL_ENV = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-flash';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL ?? 'qwen/qwen3-embedding-8b';
// Legacy Fireworks model ids cached in Firestore from before the OpenRouter
// migration — treat them as absent so the env default kicks in instead of
// sending a dead provider's model id to OpenRouter.
const LEGACY_MODEL_PREFIX = 'accounts/fireworks/';

// ── Active model config (Firestore-backed, env-var fallback) ──────────────────
// Firestore doc `appConfig/ai` stores { model: string }. The admin panel writes
// to this doc via the `setAIModel` Cloud Function. We cache the result for 60s
// so hot-path requests pay no extra Firestore read cost.
let _modelCache: { model: string; expiresAt: number } | null = null;

export async function getActiveModel(): Promise<string> {
  const now = Date.now();
  if (_modelCache && now < _modelCache.expiresAt) return _modelCache.model;
  try {
    const snap = await getDb().doc('appConfig/ai').get();
    const model = snap.data()?.model as string | undefined;
    if (model && model.length > 0 && !model.startsWith(LEGACY_MODEL_PREFIX)) {
      _modelCache = { model, expiresAt: now + 60_000 };
      return model;
    }
  } catch (e) {
    console.warn('[aiProvider] failed to read appConfig/ai, using env fallback:', e);
  }
  return OPENROUTER_MODEL_ENV;
}

/** Write the active model to Firestore and invalidate the local cache. */
export async function setActiveModel(model: string): Promise<void> {
  await getDb().doc('appConfig/ai').set(
    { model, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  _modelCache = null; // force next request to re-read
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
  if (AI_PROVIDER === 'openrouter') return generateOpenRouter(params);
  return generateGemini(params);
}

async function generateGemini(params: GenerateParams): Promise<GenerateResult> {
  const { system, messages, json, maxTokens, abortMs } = params;

  const generationConfig: Record<string, unknown> = {};
  if (json) generationConfig.responseMimeType = 'application/json';
  if (maxTokens) generationConfig.maxOutputTokens = maxTokens;

  const model = getGenAI().getGenerativeModel({
    model: GEMINI_MODEL,
    ...(system ? { systemInstruction: system } : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
  });

  const history = messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }));
  const last = messages[messages.length - 1];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), abortMs ?? 30_000);
  try {
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(last!.content, { signal: controller.signal });
    const response = result.response;
    return {
      text: response.text(),
      tokensIn: response.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: response.usageMetadata?.candidatesTokenCount ?? 0,
      model: GEMINI_MODEL,
    };
  } finally {
    clearTimeout(timeout);
  }
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
      await new Promise(r => setTimeout(r, 500 * attempt));
      continue;
    }
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
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
  if (AI_PROVIDER === 'openrouter') return embedOpenRouter(texts);
  return embedGemini(texts);
}

async function embedGemini(texts: string[]): Promise<EmbedResult> {
  const { embedMany } = await import('ai');
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY! });
  const model = google.textEmbeddingModel('text-embedding-004');
  const { embeddings } = await embedMany({ model, values: texts });
  const vectors = embeddings;
  const dim = vectors[0]?.length ?? 0;
  return { vectors, model: 'text-embedding-004', dim, tokens: 0 };
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

  const data = (await res.json()) as {
    data?: { embedding?: number[] }[];
    usage?: { total_tokens?: number };
  };

  const vectors = data.data?.map(d => d.embedding ?? []) ?? [];
  const dim = vectors[0]?.length ?? 0;
  const tokens = data.usage?.total_tokens ?? 0;
  return { vectors, model: OPENROUTER_EMBED_MODEL, dim, tokens };
}
