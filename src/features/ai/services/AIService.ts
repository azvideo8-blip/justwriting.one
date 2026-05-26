import { getFunctions, httpsCallable } from 'firebase/functions';
import { reportError } from '../../../core/errors/reportError';

export type AIAction = 'shorten' | 'accents' | 'ideas' | 'summarize' | 'tags' | 'mood' | 'continue';
export type AIMessage = { role: 'user' | 'assistant'; content: string };
export type AIResult =
  | { ok: true; text: string }
  | { ok: false; error: 'AUTH_REQUIRED' | 'DAILY_LIMIT' | 'RATE_LIMIT' | 'TOO_LONG' | 'SERVER_ERROR' };

export interface AISummaryPayload {
  tone: string;
  frequentWords: string[];
  insights: string[];
  themes: string[];
}

function mapAIError(e: unknown): 'AUTH_REQUIRED' | 'DAILY_LIMIT' | 'RATE_LIMIT' | 'TOO_LONG' | 'SERVER_ERROR' {
  const code = (e as { code?: string }).code;
  const message = (e as { message?: string }).message ?? '';
  if (code === 'functions/unauthenticated') return 'AUTH_REQUIRED';
  if (code === 'functions/resource-exhausted') {
    if (message.toLowerCase().includes('daily limit')) return 'DAILY_LIMIT';
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
      const { data } = await fn({ content, action, ...opts });
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
    customSystemPrompt?: string;
    messages: AIMessage[];
    documentContent?: string;
    documentMood?: string;
  }): Promise<AIResult> {
    const functions = getFunctions();
    const fn = httpsCallable<unknown, { result: string }>(functions, 'chatWithAI');
    try {
      const { data } = await fn(params);
      return { ok: true, text: data.result };
    } catch (e: unknown) {
      reportError(e, { action: 'chat', personaId: params.personaId });
      return { ok: false, error: mapAIError(e) };
    }
  },

  async summarize(params: {
    content: string;
    mood?: string;
  }): Promise<{ ok: true; summary: AISummaryPayload } | { ok: false; error: string }> {
    const functions = getFunctions();
    const fn = httpsCallable<unknown, AISummaryPayload>(functions, 'summarizeDocument');
    try {
      const { data } = await fn(params);
      return { ok: true, summary: data };
    } catch (e: unknown) {
      reportError(e, { action: 'summarize' });
      const errType = mapAIError(e);
      if (errType === 'DAILY_LIMIT') return { ok: false, error: 'DAILY_LIMIT' };
      if (errType === 'RATE_LIMIT') return { ok: false, error: 'RATE_LIMIT' };
      return { ok: false, error: errType };
    }
  },
};
