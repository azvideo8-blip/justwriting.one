// api/handlers.ts
import { postgresAiContext } from './postgresAiContext';
import { AiError } from '../src/shared/ai/context.js';

import { chatWithAILogic } from './ai/chatWithAI.logic';
import { editWithAILogic } from './ai/editWithAI.logic';
import { embedDocumentLogic } from './ai/embedDocument.logic';
import { extractChatMemoryLogic } from './ai/extractChatMemory.logic';
import { getAIUsageStatsLogic } from './ai/getAIUsageStats.logic';
import { getAiQuotaLogic } from './ai/getAiQuota.logic';
import { judgeBeliefCandidateLogic } from './ai/judgeBeliefCandidate.logic';
import { judgeFacetsLogic } from './ai/judgeFacets.logic';
import { rerankNotesLogic } from './ai/rerankNotes.logic';
import { summarizeBeliefClusterLogic } from './ai/summarizeBeliefCluster.logic';
import { summarizeDocumentLogic } from './ai/summarizeDocument.logic';
import { summarizeFacetLogic } from './ai/summarizeFacet.logic';
import { validateCustomPromptLogic } from './ai/validateCustomPrompt.logic';
import { deriveTaxonomyLogic } from './ai/deriveTaxonomy.logic';
import { deleteAccountLogic } from './account';
import { inviteUserLogic, listUsersWithStatusLogic } from './admin/admin.logic';

type LogicFn = (
  ctx: typeof postgresAiContext,
  uid: string,
  data: unknown,
) => Promise<unknown>;

const LOGIC_MAP: Record<string, LogicFn> = {
  chatWithAI: chatWithAILogic,
  editWithAI: editWithAILogic,
  embedDocument: embedDocumentLogic,
  extractChatMemory: extractChatMemoryLogic,
  getAIUsageStats: getAIUsageStatsLogic,
  getAiQuota: getAiQuotaLogic,
  judgeBeliefCandidate: judgeBeliefCandidateLogic,
  judgeFacets: judgeFacetsLogic,
  rerankNotes: rerankNotesLogic,
  summarizeBeliefCluster: summarizeBeliefClusterLogic,
  summarizeDocument: summarizeDocumentLogic,
  summarizeFacet: summarizeFacetLogic,
  validateCustomPrompt: validateCustomPromptLogic,
  deriveTaxonomy: deriveTaxonomyLogic,
  // Not AI, but the client reaches them the same way and they need the same
  // auth gate — so they live behind the same dispatcher.
  deleteAccount: deleteAccountLogic,
  inviteUser: inviteUserLogic,
  listUsersWithStatus: listUsersWithStatusLogic,
};

const CODE_TO_HTTP: Record<string, number> = {
  'unauthenticated': 401,
  'permission-denied': 403,
  'invalid-argument': 400,
  'resource-exhausted': 429,
  // Согласие не дано — отказ по праву субъекта, а не сбой сервиса.
  'AI_CONSENT_REQUIRED': 403,
  'internal': 500,
  'unavailable': 503,
};

export interface EndpointResult {
  status: number;
  body: unknown;
}

// Returns a status and a body rather than writing to a response object. The
// caller owns the transport: this file should not know whether it is answering
// node:http, a test, or anything else. The earlier Express-shaped signature
// forced the dispatcher to fabricate a req/res pair, and pulled in an `express`
// type import that was never a declared dependency — it resolved only because
// something else happened to bring Express along.
export async function handleAiEndpoint(
  endpoint: string,
  uid: string,
  payload: unknown,
): Promise<EndpointResult> {
  // EA-12: только собственные ключи — иначе /api/toString находил Function.prototype.toString.
  const logicFn = Object.hasOwn(LOGIC_MAP, endpoint) ? LOGIC_MAP[endpoint] : undefined;
  if (!logicFn) {
    return { status: 404, body: { error: `AI endpoint '${endpoint}' not found.` } };
  }

  // AUD-2: серверный гейт согласия. Клиентский (callAi) остаётся как
  // вежливость, но гарантией быть не может. Исключения — те же, что и там:
  // удаление аккаунта и администрирование пользователей не про обработку записей.
  if (endpoint !== 'deleteAccount' && endpoint !== 'inviteUser' && endpoint !== 'listUsersWithStatus') {
    if (endpoint === 'embedDocument') {
      // Индексация гоняет фрагменты заметок через модель эмбеддингов —
      // отдельное согласие, отдельная колонка.
      const indexing = await postgresAiContext.getIndexingConsent(uid);
      if (indexing.error === 'unavailable') {
        return { status: 503, body: { error: { code: 'unavailable', message: 'Database temporarily unavailable.' } } };
      }
      if (!indexing.granted) {
        return { status: 403, body: { error: { code: 'INDEXING_CONSENT_REQUIRED', message: 'Indexing consent required.' } } };
      }
    } else {
      const consent = await postgresAiContext.getAiConsent(uid);
      if (consent.error === 'unavailable') {
        return { status: 503, body: { error: { code: 'unavailable', message: 'Database temporarily unavailable.' } } };
      }
      if (!consent.granted) {
        return { status: 403, body: { error: { code: 'AI_CONSENT_REQUIRED', message: 'AI processing consent required.' } } };
      }
    }
  }

  try {
    const envelope = payload as { data?: unknown } | null | undefined;
    const data = envelope && typeof envelope === 'object' && 'data' in envelope
      ? envelope.data
      : payload;
    const result = await logicFn(postgresAiContext, uid, data);
    return { status: 200, body: { result } };
  } catch (e) {
    if (e instanceof AiError) {
      const status = CODE_TO_HTTP[e.code] ?? 500;
      // R5-058: 5xx от AiError уходил клиенту без строки в журнале службы.
      if (status >= 500) console.error(`[api/handlers] ${status} ${e.code} in ${endpoint}: ${e.message}`);
      return { status, body: { error: { code: e.code, message: e.message } } };
    }
    console.error(`[api/handlers] unhandled error in ${endpoint}:`, e);
    return { status: 500, body: { error: { code: 'internal', message: 'Internal server error.' } } };
  }
}
