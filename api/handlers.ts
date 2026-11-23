// api/handlers.ts
import { postgresAiContext } from './postgresAiContext';
import { AiError } from '../src/shared/ai/context.js';

import { chatWithAILogic } from './ai/chatWithAI.logic';
import { editWithAILogic } from './ai/editWithAI.logic';
import { embedDocumentLogic } from './ai/embedDocument.logic';
import { extractChatMemoryLogic } from './ai/extractChatMemory.logic';
import { getAIUsageStatsLogic } from './ai/getAIUsageStats.logic';
import { resetUserLimitLogic } from './ai/resetUserLimit.logic';
import { getAiQuotaLogic } from './ai/getAiQuota.logic';
import { judgeFacetsLogic } from './ai/judgeFacets.logic';
import { rerankNotesLogic } from './ai/rerankNotes.logic';
import { pickAnchorsLogic } from './ai/pickAnchors.logic';
import { pickInsightLogic } from './ai/pickInsight.logic';
import { matchInsightLogic } from './ai/matchInsight.logic';
import { summarizeDocumentLogic } from './ai/summarizeDocument.logic';
import { summarizeFacetLogic } from './ai/summarizeFacet.logic';
import { validateCustomPromptLogic } from './ai/validateCustomPrompt.logic';
import { deleteAccountLogic } from './account';
import { adminDeleteUserLogic, inviteUserLogic, listAdminActionsLogic, listUsersWithStatusLogic, listStaleInvitesLogic, deleteStaleInvitesLogic } from './admin/admin.logic';
import { safeErrorShape } from '../src/shared/ai/errorShape.js';
import { CONSENT_EXEMPT_ENDPOINTS } from '../src/shared/ai/aiPolicy.js';

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
  resetUserLimit: resetUserLimitLogic,
  judgeFacets: judgeFacetsLogic,
  rerankNotes: rerankNotesLogic,
  pickAnchors: pickAnchorsLogic,
  pickInsight: pickInsightLogic,
  matchInsight: matchInsightLogic,
  summarizeDocument: summarizeDocumentLogic,
  summarizeFacet: summarizeFacetLogic,
  validateCustomPrompt: validateCustomPromptLogic,
  // Not AI, but the client reaches them the same way and they need the same
  // auth gate — so they live behind the same dispatcher.
  deleteAccount: deleteAccountLogic,
  inviteUser: inviteUserLogic,
  listUsersWithStatus: listUsersWithStatusLogic,
  listAdminActions: listAdminActionsLogic,
  listStaleInvites: listStaleInvitesLogic,
  deleteStaleInvites: deleteStaleInvitesLogic,
  adminDeleteUser: adminDeleteUserLogic,
};

const CODE_TO_HTTP: Record<string, number> = {
  'unauthenticated': 401,
  'permission-denied': 403,
  'invalid-argument': 400,
  'resource-exhausted': 429,
  // Согласие не дано — отказ по праву субъекта, а не сбой сервиса.
  'AI_CONSENT_REQUIRED': 403,
  // X-2: отказ по формулировке реплики — тоже отказ, а не сбой: клиенту нужен
  // текст «перефразируй», а не обещание повтора.
  'DISALLOWED_PHRASE': 400,
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
// Дейлик 31.10 (Н-3): 503 гейта согласия уходит значением мимо sendError —
// без строки в журнале монитор (E-8) его не видел. Метка та же, [api-5xx].
function consentUnavailable(endpoint: string) {
  console.error(`[api-5xx] 503 unavailable in ${endpoint}`);
  return { status: 503, body: { error: { code: 'unavailable', message: 'Database temporarily unavailable.' } } };
}

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
  // вежливость, но гарантией быть не может. Исключения — общий список с ним.
  if (!CONSENT_EXEMPT_ENDPOINTS.has(endpoint)) {
    if (endpoint === 'embedDocument') {
      // Индексация гоняет фрагменты заметок через модель эмбеддингов —
      // отдельное согласие, отдельная колонка.
      const indexing = await postgresAiContext.getIndexingConsent(uid);
      if (indexing.error === 'unavailable') {
        return consentUnavailable(endpoint);
      }
      if (!indexing.granted) {
        return { status: 403, body: { error: { code: 'INDEXING_CONSENT_REQUIRED', message: 'Indexing consent required.' } } };
      }
    } else {
      const consent = await postgresAiContext.getAiConsent(uid);
      if (consent.error === 'unavailable') {
        return consentUnavailable(endpoint);
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
      if (status >= 500) console.error(`[api/handlers] ${status} ${e.code} in ${endpoint}`);
      return { status, body: { error: { code: e.code, message: e.message } } };
    }
    console.error(`[api/handlers] unhandled error in ${endpoint}:`, safeErrorShape(e));
    return { status: 500, body: { error: { code: 'internal', message: 'Internal server error.' } } };
  }
}
