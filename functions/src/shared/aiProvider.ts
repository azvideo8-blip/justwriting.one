import { GEMINI_MODEL, getGenAI } from './aiUtils';
import { getDb } from './firestore';
import { FieldValue } from 'firebase-admin/firestore';

// Provider seam: lets the same call sites run against Gemini (Google) or a
// Fireworks-hosted OpenAI-compatible model (e.g. DeepSeek). Switch via the
// AI_PROVIDER env var; Gemini stays available as a fallback.
export const AI_PROVIDER = (process.env.AI_PROVIDER ?? 'fireworks').toLowerCase();
// Env-var default for the Fireworks model (used if Firestore config is absent).
const FIREWORKS_MODEL_ENV = process.env.FIREWORKS_MODEL ?? 'accounts/fireworks/models/deepseek-v4-flash';
const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
const FIREWORKS_EMBED_MODEL = process.env.FIREWORKS_EMBED_MODEL ?? 'fireworks/qwen3-embedding-8b';
const EMBED_DIMENSIONS = 1024;

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
    if (model && model.length > 0) {
      _modelCache = { model, expiresAt: now + 60_000 };
      return model;
    }
  } catch (e) {
    console.warn('[aiProvider] failed to read appConfig/ai, using env fallback:', e);
  }
  return FIREWORKS_MODEL_ENV;
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
  /** Override the Fireworks model for this call (e.g. an obedient non-reasoning
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
  if (AI_PROVIDER === 'fireworks') return generateFireworks(params);
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

async function generateFireworks(params: GenerateParams): Promise<GenerateResult> {
  const { system, messages, json, maxTokens, abortMs } = params;

  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) throw new Error('FIREWORKS_API_KEY not set');

  const activeModel = params.model ?? await getActiveModel();

  const oaMessages: { role: string; content: string }[] = [];
  if (system) oaMessages.push({ role: 'system', content: system });
  for (const m of messages) oaMessages.push({ role: m.role, content: m.content });

  const body: Record<string, unknown> = {
    model: activeModel,
    messages: oaMessages,
    max_tokens: maxTokens ?? 4096,
  };
  if (json) body.response_format = { type: 'json_object' };

  // Retry transient upstream errors (502/503/504 "no healthy upstream") with a
  // short backoff — Fireworks serverless models occasionally return these.
  const MAX_ATTEMPTS = 3;
  let res!: Response;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), abortMs ?? 110_000);
    try {
      res = await fetch(`${FIREWORKS_BASE_URL}/chat/completions`, {
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
    throw new Error(`Fireworks ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  // DeepSeek reasoning lands in a separate `reasoning_content` field which we
  // intentionally drop — only the final answer in `content` is returned.
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
  if (AI_PROVIDER === 'fireworks') return embedFireworks(texts);
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

async function embedFireworks(texts: string[]): Promise<EmbedResult> {
  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) throw new Error('FIREWORKS_API_KEY not set');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(`${FIREWORKS_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: FIREWORKS_EMBED_MODEL,
        input: texts,
        dimensions: EMBED_DIMENSIONS,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Fireworks embed ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    data?: { embedding?: number[] }[];
    usage?: { total_tokens?: number };
  };

  const vectors = data.data?.map(d => d.embedding ?? []) ?? [];
  const dim = vectors[0]?.length ?? 0;
  const tokens = data.usage?.total_tokens ?? 0;
  return { vectors, model: FIREWORKS_EMBED_MODEL, dim, tokens };
}
