import { getFunctions, httpsCallable } from 'firebase/functions';
import { reportError } from '../../../shared/errors/reportError';
import { withTimeout } from '../../../shared/utils/withTimeout';
import { analytics } from '../../../core/analytics/analytics';

export type AIAction = 'shorten' | 'accents' | 'ideas' | 'summarize' | 'tags' | 'mood' | 'continue';
export type AIMessage = { role: 'user' | 'assistant'; content: string; type?: 'chat' | 'system' | undefined };
export type AIResult =
  | { ok: true; text: string }
  | { ok: false; error: 'AUTH_REQUIRED' | 'DAILY_LIMIT' | 'RATE_LIMIT' | 'TOO_LONG' | 'SERVER_ERROR' };

export interface AISummaryPayload {
  tone: string;
  frequentWords: string[];
  insights: string[];
  themes: string[];
  extractedFacts: string[];
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
      const { data } = await withTimeout(fn({ content, action, ...opts }), 60_000);
      try { analytics.track('ai_action', { action }); } catch { /* non-critical */ }
      return { ok: true, text: data.result };
    } catch (e: unknown) {
      reportError(e, { action: 'process', aiAction: action });
      return { ok: false, error: mapAIError(e) };
    }
  },

  parseTags(text: string): string[] {
    try { return JSON.parse(text); } catch (e) { reportError(e, { action: 'parseTags' }); return []; }
  },

  async chat(params: {
    personaId: string;
    customSystemPrompt?: string | undefined;
    messages: AIMessage[];
    documentContent?: string | undefined;
    documentMood?: string | undefined;
    userPortrait?: string | null | undefined;
  }): Promise<AIResult> {
    const functions = getFunctions();
    const fn = httpsCallable<unknown, { result: string }>(functions, 'chatWithAI');
    try {
      const { data } = await withTimeout(fn(params), 60_000);
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
  }): Promise<{ ok: true; summary: AISummaryPayload } | { ok: false; error: string }> {
    const functions = getFunctions();
    const fn = httpsCallable<unknown, AISummaryPayload>(functions, 'summarizeDocument');
    try {
      const { data } = await withTimeout(fn(params), 60_000);
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
  }): Promise<{ ok: true; vector: number[]; model: string; dim: number } | { ok: false; error: string }> {
    const functions = getFunctions();
    const fn = httpsCallable<unknown, { vector: number[]; model: string; dim: number }>(functions, 'embedDocument');
    try {
      const { data } = await withTimeout(fn(params), 60_000);
      try { analytics.track('ai_embed'); } catch { /* non-critical */ }
      return { ok: true, vector: data.vector, model: data.model, dim: data.dim };
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
};
