import { getFunctions, httpsCallable } from 'firebase/functions';

export type AIAction = 'shorten' | 'accents' | 'ideas' | 'summarize' | 'tags' | 'mood' | 'continue';

export type AIMessage = { role: 'user' | 'assistant'; content: string };

export type AIResult =
  | { ok: true; text: string }
  | { ok: false; error: 'AUTH_REQUIRED' | 'RATE_LIMIT' | 'TOO_LONG' | 'SERVER_ERROR' };

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
      const code = (e as { code?: string }).code;
      if (code === 'functions/unauthenticated') return { ok: false, error: 'AUTH_REQUIRED' };
      if (code === 'functions/resource-exhausted') return { ok: false, error: 'RATE_LIMIT' };
      if (code === 'functions/invalid-argument') return { ok: false, error: 'TOO_LONG' };
      return { ok: false, error: 'SERVER_ERROR' };
    }
  },

  parseTags(text: string): string[] {
    try { return JSON.parse(text); } catch { return []; }
  },
};
