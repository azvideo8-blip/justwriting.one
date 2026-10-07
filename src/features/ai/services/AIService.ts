import { getCurrentUser, getIdToken } from '../../../core/auth';
import type { NoteScope } from '../../../shared/ai/buildChatPrompt';
import { reportError } from '../../../shared/errors/reportError';
import { withTimeout } from '../../../shared/utils/withTimeout';
import { callAi, type CallAiOptions } from '../../../core/ai/callAi';
import type { AIErrorCode } from '../types/aiErrors';

export type { AIErrorCode };

// Generation calls (chat/edit/summarize) let the model run up to abortMs=110s
// server-side, inside a 120s function timeout. A 60s client timeout used to
// abort perfectly good generations before the answer came back.
const GEN_TIMEOUT_MS = 115_000;

export type AIAction = 'accents' | 'ideas' | 'summarize' | 'punctuate' | 'gratitude' | 'achievements';
export type AIMessage = { role: 'user' | 'assistant'; content: string; type?: 'chat' | 'system' | undefined };

export type AIResult =
  | { ok: true; text: string }
  | { ok: false; error: AIErrorCode };

export interface AISummaryPayload {
  summary?: string;
  tone: string;
  frequentWords: string[];
  authorPhrases?: string[];
  insights: string[];
  quotableSentence?: string;
  themes: string[];
  extractedFacts: string[];
  commitments?: string[];
  valence?: number;
  arousal?: number;
  echo?: string;
  eventDate?: string;
  promptVersion?: number;
}

export function mapAIError(e: unknown): AIErrorCode {
  // Коды приходят от нашего HTTP-API без префикса ('resource-exhausted').
  // Префикс `functions/` — наследие Firebase SDK, которого в сборке уже нет;
  // после переезда на VPS ни одна ветка ниже по нему не совпадала, и КАЖДЫЙ
  // отказ по лимиту, авторизации и разбору тела превращался в SERVER_ERROR.
  // Поэтому здесь нормализация, а не отдельные ветки на две формы.
  const rawCode = (e as { code?: string }).code ?? '';
  const code = rawCode.startsWith('functions/') ? rawCode.slice('functions/'.length) : rawCode;
  const status = (e as { status?: number }).status;
  const message = (e as { message?: string }).message ?? '';
  if (code === 'AI_CONSENT_REQUIRED' || message === 'AI_CONSENT_REQUIRED') return 'AI_CONSENT_REQUIRED';
  if (code === 'INDEXING_CONSENT_REQUIRED' ||
    message === 'INDEXING_CONSENT_REQUIRED' ||
    message.includes('Indexing consent required')
  ) return 'INDEXING_CONSENT_REQUIRED';
  // X-2: отказ по формулировке реплики. Без этой ветки он падал в общий код, и
  // человек читал «попробуй позже» там, где повтор никогда не помогает.
  if (code === 'DISALLOWED_PHRASE' || message === 'DISALLOWED_PHRASE') return 'DISALLOWED_PHRASE';
  // Связь оборвалась, а не сервис сломался. Раньше всё это попадало в
  // SERVER_ERROR и писалось в журнал уровнем error, так что день с отвалившимся
  // прокси выглядел как день с поломанным приложением.
  //
  // 'internal' с сообщением ровно 'internal' — это SDK, не наша функция:
  // chatWithAI бросает internal только с причиной (UNKNOWN / BAD_REQUEST /
  // MISCONFIGURED), а judgeFacets не бросает его ни на одном пути.
  if (code === 'internal' && message.trim().toLowerCase() === 'internal') return 'NETWORK';
  if (code === 'deadline-exceeded' || message === 'deadline-exceeded' || message === 'Timeout' || (e as { isTimeout?: boolean }).isTimeout) return 'NETWORK';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'NETWORK';
  if (
    code?.toLowerCase() === 'unauthenticated' ||
    message.toUpperCase() === 'AUTH_REQUIRED' ||
    message.toLowerCase() === 'unauthenticated' ||
    status === 401
  ) return 'AUTH_REQUIRED';
  if (code === 'resource-exhausted' || status === 429) {
    const errData = (e as { details?: { errorType?: string } }).details;
    // Дневной потолок и минутное окно приходят одним кодом и различаются только
    // текстом. Сообщений о дне два — «Daily limit reached.» и «Daily bulk
    // operations limit reached.», — и точная подстрока 'daily limit' второе из
    // них не ловила: исчерпанный фоновый лимит читался как «подождите минуту»,
    // то есть предлагал повторять до утра.
    if (errData?.errorType === 'BULK_LIMIT' || message.toLowerCase().includes('bulk')) return 'BULK_LIMIT';
    if (errData?.errorType === 'DAILY_LIMIT' || message.toLowerCase().includes('daily')) return 'DAILY_LIMIT';
    return 'RATE_LIMIT';
  }
  if (code === 'invalid-argument') return 'TOO_LONG';
  // The model provider failed, not us. Worth its own code: it is the one cause
  // where retrying in a minute is the right advice, and where the user should
  // not wonder whether something is wrong with their notes or their account.
  if (code === 'unavailable' || status === 503) {
    if (message.includes('could not check') || code === 'SERVICE_UNAVAILABLE') {
      return 'SERVICE_UNAVAILABLE';
    }
    return 'UPSTREAM';
  }
  return 'SERVER_ERROR';
}

/** Один повтор после принудительного обновления токена. Отказ авторизации при
 *  живом пользователе почти всегда значит, что обновление токена не прошло по
 *  сети, а что человек не зарегистрирован: securetoken отвалился, вызов ушёл
 *  без действующего токена, функция отказала. */
async function retryAfterTokenRefresh<T>(call: () => Promise<T>): Promise<T> {
  const user = getCurrentUser();
  if (!user) throw new Error('NOT_SIGNED_IN');
  await getIdToken(true);
  return call();
}

export const AIService = {
  async process(
    content: string,
    action: AIAction,
    opts?: { sessionId?: string; history?: AIMessage[] }
  ): Promise<AIResult> {
    try {
      const data = await withTimeout(callAi<{ result: string }>('editWithAI', { content, action, ...opts }), GEN_TIMEOUT_MS);
      return { ok: true, text: data.result };
    } catch (e: unknown) {
      const code = mapAIError(e);
      reportError(e, { action: 'process', aiAction: action, aiError: code }, 'warning');
      return { ok: false, error: code };
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
    noteScope?: NoteScope | undefined;
    responseLength?: 'short' | 'standard' | 'detailed' | undefined;
    reasoning?: boolean | undefined;
    callType?: 'auto_name' | 'follow_up' | 'query_expand' | 'system_task' | undefined;
  }, opts?: CallAiOptions): Promise<AIResult> {

    try {
      const data = await withTimeout(callAi<{ result: string }>('chatWithAI', params, opts), GEN_TIMEOUT_MS);
      return { ok: true, text: data.result };
    } catch (e: unknown) {
      const code = mapAIError(e);
      if (code === 'AUTH_REQUIRED' && getCurrentUser()) {
        try {
          const data = await retryAfterTokenRefresh(() => withTimeout(callAi<{ result: string }>('chatWithAI', params, opts), GEN_TIMEOUT_MS));
          return { ok: true, text: data.result };
        } catch { /* второй отказ — сообщаем честно ниже */ }
      }
      // S-31: отсутствие согласия — состояние, а не сбой: в журнале активности
      // оно выглядело бы как техническая ошибка.
      if (code !== 'AI_CONSENT_REQUIRED' && code !== 'INDEXING_CONSENT_REQUIRED') {
        reportError(e, { action: 'chat', personaId: params.personaId, aiError: code }, 'warning');
      }
      return { ok: false, error: code };
    }
  },

  async summarize(params: {
    content: string;
    mood?: string | undefined;
    noteDate?: string | undefined;
  }): Promise<{ ok: true; summary: AISummaryPayload } | { ok: false; error: string }> {
    try {
      const data = await withTimeout(callAi<AISummaryPayload>('summarizeDocument', params), GEN_TIMEOUT_MS);
      return { ok: true, summary: data };
    } catch (e: unknown) {
      const code = mapAIError(e);
      reportError(e, { action: 'summarize', aiError: code }, 'warning');
      if (code === 'DAILY_LIMIT') return { ok: false, error: 'DAILY_LIMIT' };
      if (code === 'RATE_LIMIT') return { ok: false, error: 'RATE_LIMIT' };
      return { ok: false, error: code };
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

    try {
      const data = await withTimeout(callAi<{ vectors: number[][]; chunks: string[]; model: string; dim: number }>('embedDocument', params), 60_000);
      return { ok: true, vectors: data.vectors, chunks: data.chunks ?? [], model: data.model, dim: data.dim };
    } catch (e: unknown) {
      const errType = mapAIError(e);
      // S-40: отсутствие согласия на ИИ — состояние, не сбой (как и индексация).
      if (errType !== 'AI_CONSENT_REQUIRED' && errType !== 'INDEXING_CONSENT_REQUIRED' && (e as { code?: string })?.code !== 'INDEXING_CONSENT_REQUIRED') {
        reportError(e, { action: 'embed' }, 'warning');
      }
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
      const data = await withTimeout(callAi<{ documentIds: string[] }>('rerankNotes', clamped), 60_000);
      return { ok: true, documentIds: data.documentIds };
    } catch (e: unknown) {
      const error = mapAIError(e);
      // S-56: нет согласия — состояние, а не сбой; в журнал не пишется.
      if (error !== 'AI_CONSENT_REQUIRED' && error !== 'INDEXING_CONSENT_REQUIRED') reportError(e, { action: 'rerank' }, 'warning');
      return { ok: false, error };
    }
  },

  async summarizeFacet(params: {
    notes: { title: string; excerpt: string }[];
    focus?: string | null | undefined;
    correction?: string | undefined;
  }, opts?: CallAiOptions): Promise<{ ok: true; label: string; summary: string } | { ok: false; error: string }> {
    try {
      const { focus, ...rest } = params;
      const payload = { ...rest, ...(focus ? { focus } : {}) };
      const data = await withTimeout(callAi<{ label: string; summary: string }>('summarizeFacet', payload, opts), 60_000);
      return { ok: true, label: data.label, summary: data.summary };
    } catch (e: unknown) {
      reportError(e, { action: 'summarizeFacet' }, 'warning');
      return { ok: false, error: mapAIError(e) };
    }
  },

  async deriveTaxonomy(params: { digest: string }, opts?: CallAiOptions): Promise<
    { ok: true; domains: { label: string; seed: string }[] } | { ok: false; error: AIErrorCode }
  > {
    try {
      const res = await withTimeout(callAi<{ domains: { label: string; seed: string }[] }>('deriveTaxonomy', params, opts), 60_000);
      return { ok: true, domains: res.domains ?? [] };
    } catch (e) {
      reportError(e, { action: 'deriveTaxonomy' }, 'warning');
      // Сырой код Firebase здесь бесполезен: вызывающая сторона сравнивает его с
      // нормализованными кодами, и сравнение не совпадало никогда.
      return { ok: false, error: mapAIError(e) };
    }
  },

  async judgeFacets(params: { facets: { facetId: string; label: string; summary: string; evidence: string }[] }, opts?: CallAiOptions): Promise<
    { ok: true; verdicts: { facetId: string; ok: boolean; issues: string[]; hint: string }[] } | { ok: false; error: AIErrorCode }
  > {
    try {
      const res = await withTimeout(callAi<{ verdicts: { facetId: string; ok: boolean; issues: string[]; hint: string }[] }>('judgeFacets', params, opts), 60_000);
      return { ok: true, verdicts: res.verdicts ?? [] };
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
    try {
      const data = await withTimeout(callAi<{ memories: { kind: string; text: string }[] }>('extractChatMemory', params), 60_000);
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
  }, opts?: CallAiOptions): Promise<{ ok: true; belief: string } | { ok: false; error: string }> {
    try {
      const data = await withTimeout(callAi<{ belief: string }>('summarizeBeliefCluster', params, opts), 60_000);
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
  }, opts?: CallAiOptions): Promise<{ ok: true; passed: boolean; reason: string; correctiveHint?: string } | { ok: false; error: string }> {
    try {
      const data = await withTimeout(callAi<{ passed: boolean; reason: string; correctiveHint?: string }>('judgeBeliefCandidate', params, opts), 60_000);
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
