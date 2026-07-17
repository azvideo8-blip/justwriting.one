import { getFunctions, httpsCallable } from 'firebase/functions';
import { reportError } from '../../../shared/errors/reportError';
import { withTimeout } from '../../../shared/utils/withTimeout';
import { analytics } from '../../../core/analytics/analytics';

// Generation calls (chat/edit/summarize) let the model run up to abortMs=110s
// server-side, inside a 120s function timeout. A 60s client timeout used to
// abort perfectly good generations before the answer came back.
const GEN_TIMEOUT_MS = 115_000;

export type AIAction = 'accents' | 'ideas' | 'summarize' | 'continue' | 'gratitude' | 'achievements';
export type AIMessage = { role: 'user' | 'assistant'; content: string; type?: 'chat' | 'system' | undefined };
export type AIResult =
  | { ok: true; text: string }
  | { ok: false; error: 'AUTH_REQUIRED' | 'DAILY_LIMIT' | 'RATE_LIMIT' | 'TOO_LONG' | 'SERVER_ERROR' };

export interface AISummaryPayload {
  summary?: string;
  tone: string;
  frequentWords: string[];
  insights: string[];
  themes: string[];
  extractedFacts: string[];
  mentionedPeople?: { name: string; role: string }[];
  commitments?: string[];
  valence?: number;
  arousal?: number;
  echo?: string;
}

function mapAIError(e: unknown): 'AUTH_REQUIRED' | 'DAILY_LIMIT' | 'RATE_LIMIT' | 'TOO_LONG' | 'SERVER_ERROR' {
  const code = (e as { code?: string }).code;
  const message = (e as { message?: string }).message ?? '';
  if (code === 'functions/unauthenticated') return 'AUTH_REQUIRED';
  if (code === 'functions/resource-exhausted') {
    const errData = (e as { details?: { errorType?: string } }).details;
    if (errData?.errorType === 'DAILY_LIMIT' || message.toLowerCase().includes('daily limit')) return 'DAILY_LIMIT';
    return 'RATE_LIMIT';
  }
  if (code === 'functions/invalid-argument') return 'TOO_LONG';
  return 'SERVER_ERROR';
}

export const AIService = {
  async process(
    content: string,
    action: AIAction,
    opts?: { sessionId?: string; history?: AIMessage[] }
  ): Promise<AIResult> {
    const functions = getFunctions();
    const fn = httpsCallable<unknown, { result: string }>(functions, 'editWithAI');
    try {
      const { data } = await withTimeout(fn({ content, action, ...opts }), GEN_TIMEOUT_MS);
      try { analytics.track('ai_action', { action }); } catch { /* non-critical */ }
      return { ok: true, text: data.result };
    } catch (e: unknown) {
      reportError(e, { action: 'process', aiAction: action });
      return { ok: false, error: mapAIError(e) };
    }
  },

  parseTags(text: string): string[] {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter((x: unknown) => typeof x === 'string');
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).tags)) {
        return ((parsed as Record<string, unknown>).tags as unknown[]).filter((x: unknown) => typeof x === 'string') as string[];
      }
      return [];
    } catch (e) { reportError(e, { action: 'parseTags' }); return []; }
  },

  async chat(params: {
    personaId: string;
    customSystemPrompt?: string | undefined;
    messages: AIMessage[];
    documentContent?: string | undefined;
    documentMood?: string | undefined;
    userPortrait?: string | null | undefined;
    responseLength?: 'short' | 'standard' | 'detailed' | undefined;
    reasoning?: boolean | undefined;
    callType?: 'auto_name' | 'follow_up' | 'query_expand' | undefined;
  }): Promise<AIResult> {
    const functions = getFunctions();
    const fn = httpsCallable<unknown, { result: string }>(functions, 'chatWithAI');
    try {
      const { data } = await withTimeout(fn(params), GEN_TIMEOUT_MS);
      try { analytics.track('ai_chat', { personaId: params.personaId }); } catch { /* non-critical */ }
      return { ok: true, text: data.result };
    } catch (e: unknown) {
      reportError(e, { action: 'chat', personaId: params.personaId });
      return { ok: false, error: mapAIError(e) };
    }
  },

  async summarize(params: {
    content: string;
    mood?: string | undefined;
    recentContext?: string | undefined;
  }): Promise<{ ok: true; summary: AISummaryPayload } | { ok: false; error: string }> {
    const functions = getFunctions();
    const fn = httpsCallable<unknown, AISummaryPayload>(functions, 'summarizeDocument');
    try {
      const { data } = await withTimeout(fn(params), GEN_TIMEOUT_MS);
      try { analytics.track('ai_summarize'); } catch { /* non-critical */ }
      return { ok: true, summary: data };
    } catch (e: unknown) {
      reportError(e, { action: 'summarize' });
      const errType = mapAIError(e);
      if (errType === 'DAILY_LIMIT') return { ok: false, error: 'DAILY_LIMIT' };
      if (errType === 'RATE_LIMIT') return { ok: false, error: 'RATE_LIMIT' };
      return { ok: false, error: errType };
    }
  },

  async embed(params: {
    content: string;
  }): Promise<{ ok: true; vectors: number[][]; chunks: string[]; model: string; dim: number } | { ok: false; error: string }> {
    const functions = getFunctions();
    const fn = httpsCallable<unknown, { vectors: number[][]; chunks: string[]; model: string; dim: number }>(functions, 'embedDocument');
    try {
      const { data } = await withTimeout(fn(params), 60_000);
      try { analytics.track('ai_embed'); } catch { /* non-critical */ }
      return { ok: true, vectors: data.vectors, chunks: data.chunks ?? [], model: data.model, dim: data.dim };
    } catch (e: unknown) {
      reportError(e, { action: 'embed' });
      const errType = mapAIError(e);
      if (errType === 'DAILY_LIMIT') return { ok: false, error: 'DAILY_LIMIT' };
      if (errType === 'RATE_LIMIT') return { ok: false, error: 'RATE_LIMIT' };
      return { ok: false, error: errType };
    }
  },

  async rerank(params: {
    query: string;
    candidates: { documentId: string; card: string }[];
    maxResults?: number;
  }): Promise<{ ok: true; documentIds: string[] } | { ok: false; error: string }> {
    const functions = getFunctions();
    const fn = httpsCallable<unknown, { documentIds: string[] }>(functions, 'rerankNotes');
    try {
      const { data } = await withTimeout(fn(params), 60_000);
      return { ok: true, documentIds: data.documentIds };
    } catch (e: unknown) {
      reportError(e, { action: 'rerank' });
      return { ok: false, error: mapAIError(e) };
    }
  },

  async summarizeFacet(params: {
    notes: { title: string; excerpt: string }[];
    focus?: string | null | undefined;
    correction?: string | undefined;
  }): Promise<{ ok: true; label: string; summary: string } | { ok: false; error: string }> {
    const functions = getFunctions();
    const fn = httpsCallable<unknown, { label: string; summary: string }>(functions, 'summarizeFacet');
    try {
      const { focus, ...rest } = params;
      const payload = { ...rest, ...(focus ? { focus } : {}) };
      const { data } = await withTimeout(fn(payload), 60_000);
      return { ok: true, label: data.label, summary: data.summary };
    } catch (e: unknown) {
      reportError(e, { action: 'summarizeFacet' });
      return { ok: false, error: mapAIError(e) };
    }
  },

  async deriveTaxonomy(params: { digest: string }): Promise<
    { ok: true; domains: { label: string; seed: string }[] } | { ok: false; error: string }
  > {
    const functions = getFunctions();
    try {
      const fn = httpsCallable<unknown, { domains: { label: string; seed: string }[] }>(functions, 'deriveTaxonomy');
      const res = await withTimeout(fn(params), 60_000);
      return { ok: true, domains: res.data.domains ?? [] };
    } catch (e) {
      reportError(e, { action: 'deriveTaxonomy' });
      return { ok: false, error: String((e as { code?: string })?.code ?? 'error') };
    }
  },

  async judgeFacets(params: { facets: { facetId: string; label: string; summary: string; evidence: string }[] }): Promise<
    { ok: true; verdicts: { facetId: string; ok: boolean; issues: string[]; hint: string }[] } | { ok: false; error: string }
  > {
    const functions = getFunctions();
    try {
      const fn = httpsCallable<unknown, { verdicts: { facetId: string; ok: boolean; issues: string[]; hint: string }[] }>(functions, 'judgeFacets');
      const res = await withTimeout(fn(params), 60_000);
      return { ok: true, verdicts: res.data.verdicts ?? [] };
    } catch (e) {
      reportError(e, { action: 'judgeFacets' });
      return { ok: false, error: String((e as { code?: string })?.code ?? 'error') };
    }
  },

  async extractChatMemory(params: {
    messages: { role: string; content: string }[];
  }): Promise<{ ok: true; memories: { kind: string; text: string }[] } | { ok: false; error: string }> {
    const functions = getFunctions();
    const fn = httpsCallable<unknown, { memories: { kind: string; text: string }[] }>(functions, 'extractChatMemory');
    try {
      const { data } = await withTimeout(fn(params), 60_000);
      return { ok: true, memories: data.memories };
    } catch (e: unknown) {
      reportError(e, { action: 'extractChatMemory' });
      return { ok: false, error: mapAIError(e) };
    }
  },
};
