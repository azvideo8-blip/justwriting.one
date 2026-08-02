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
  | { ok: false; error: 'AUTH_REQUIRED' | 'DAILY_LIMIT' | 'RATE_LIMIT' | 'TOO_LONG' | 'UPSTREAM' | 'SERVER_ERROR' };

export interface AISummaryPayload {
  summary?: string;
  tone: string;
  frequentWords: string[];
  authorPhrases?: string[];
  insights: string[];
  quotableSentence?: string;
  themes: string[];
  extractedFacts: string[];
  mentionedPeople?: { name: string; role: string }[];
  commitments?: string[];
  valence?: number;
  arousal?: number;
  echo?: string;
  eventDate?: string;
  promptVersion?: number;
}

function mapAIError(e: unknown): 'AUTH_REQUIRED' | 'DAILY_LIMIT' | 'RATE_LIMIT' | 'TOO_LONG' | 'UPSTREAM' | 'SERVER_ERROR' {
  const code = (e as { code?: string }).code;
  const message = (e as { message?: string }).message ?? '';
  if (code === 'functions/unauthenticated') return 'AUTH_REQUIRED';
  if (code === 'functions/resource-exhausted') {
    const errData = (e as { details?: { errorType?: string } }).details;
    if (errData?.errorType === 'DAILY_LIMIT' || message.toLowerCase().includes('daily limit')) return 'DAILY_LIMIT';
    return 'RATE_LIMIT';
  }
  if (code === 'functions/invalid-argument') return 'TOO_LONG';
  // The model provider failed, not us. Worth its own code: it is the one cause
  // where retrying in a minute is the right advice, and where the user should
  // not wonder whether something is wrong with their notes or their account.
  if (code === 'functions/unavailable') return 'UPSTREAM';
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
    memoryContext?: string | null | undefined;
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
    noteDate?: string | undefined;
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
    // Server schema is content: z.string().min(1).max(200_000). Callers (search
    // queries, chat memory, facet seeds, theme strings) can legitimately produce
    // empty/oversized text; without this guard every such case became a 400
    // invalid-argument round-trip. Guard once here instead of at 9 call sites.
    const content = params.content?.trim() ?? '';
    if (content === '') return { ok: false, error: 'EMPTY_CONTENT' };
    if (content.length > 200_000) return { ok: false, error: 'CONTENT_TOO_LARGE' };
    params = { ...params, content };

    const functions = getFunctions();
    const fn = httpsCallable<unknown, { vectors: number[][]; chunks: string[]; model: string; dim: number }>(functions, 'embedDocument');
    try {
      const { data } = await withTimeout(fn(params), 60_000);
      try { analytics.track('ai_embed'); } catch { /* non-critical */ }
      return { ok: true, vectors: data.vectors, chunks: data.chunks ?? [], model: data.model, dim: data.dim };
    } catch (e: unknown) {
      reportError(e, { action: 'embed' }, 'warning');
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
    // The endpoint caps the query at 2 000 characters and a card at 4 000, and
    // rejects the whole call with "Invalid payload" when either is over. The
    // query grows on its own — a sticky search appends the previous query to the
    // new message — and a card carries a full summary plus an excerpt, so both
    // limits were being crossed in ordinary use and the search silently lost its
    // reranking. Clamp here, where the contract is known.
    const clamped = {
      ...params,
      query: params.query.slice(0, 2_000),
      candidates: params.candidates.map(c => ({ ...c, card: c.card.slice(0, 4_000) })),
    };
    try {
      const { data } = await withTimeout(fn(clamped), 60_000);
      return { ok: true, documentIds: data.documentIds };
    } catch (e: unknown) {
      reportError(e, { action: 'rerank' }, 'warning');
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
      reportError(e, { action: 'summarizeFacet' }, 'warning');
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
      reportError(e, { action: 'deriveTaxonomy' }, 'warning');
      // Сырой код Firebase здесь бесполезен: вызывающая сторона сравнивает его с
      // нормализованными кодами, и сравнение не совпадало никогда.
      return { ok: false, error: mapAIError(e) };
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
      reportError(e, { action: 'judgeFacets' }, 'warning');
      // Из-за сырого кода Firebase остановка перебора в AIFacetJudgeService не
      // срабатывала ни разу: недоступный сервис давал по ошибке на каждую порцию.
      return { ok: false, error: mapAIError(e) };
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
      reportError(e, { action: 'extractChatMemory' }, 'warning');
      return { ok: false, error: mapAIError(e) };
    }
  },

  async summarizeBeliefCluster(params: {
    evidence: { id: string; date: string; snippet?: string }[];
    firstSeenAt: string;
    correctionHint?: string;
  }): Promise<{ ok: true; belief: string } | { ok: false; error: string }> {
    const functions = getFunctions();
    const fn = httpsCallable<unknown, { belief: string }>(functions, 'summarizeBeliefCluster');
    try {
      const { data } = await withTimeout(fn(params), 60_000);
      return { ok: true, belief: data.belief };
    } catch (e: unknown) {
      // No chat() fallback here on purpose: this is background consolidation, and
      // this.chat() without a callType spends the user's INTERACTIVE daily quota
      // (plus the cooldown). A background pass must never eat the allowance the
      // user needs to actually talk to the AI — failing soft and retrying on the
      // next idle pass is the correct degradation.
      reportError(e, { action: 'summarizeBeliefCluster' }, 'warning');
      return { ok: false, error: mapAIError(e) };
    }
  },

  async judgeBeliefCandidate(params: {
    belief: string;
    evidence: { id: string; date: string; snippet?: string }[];
  }): Promise<{ ok: true; passed: boolean; reason: string; correctiveHint?: string } | { ok: false; error: string }> {
    const functions = getFunctions();
    const fn = httpsCallable<unknown, { passed: boolean; reason: string; correctiveHint?: string }>(functions, 'judgeBeliefCandidate');
    try {
      const { data } = await withTimeout(fn(params), 60_000);
      const hint = data.correctiveHint ?? undefined;
      return {
        ok: true,
        passed: data.passed,
        reason: data.reason,
        ...(hint ? { correctiveHint: hint } : {}),
      };
    } catch (e: unknown) {
      // No chat() fallback: same reason as summarizeBeliefCluster — a background
      // judge must not spend the user's interactive chat quota. Failing soft also
      // keeps the fail-open guarantee intact: no verdict means the belief is not
      // published and the raw units stay queryable.
      reportError(e, { action: 'judgeBeliefCandidate' }, 'warning');
      return { ok: false, error: mapAIError(e) };
    }
  },
};
