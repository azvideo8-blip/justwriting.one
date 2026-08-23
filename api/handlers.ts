// api/handlers.ts
import { postgresAiContext } from './postgresAiContext';
import { AiError } from '../src/shared/ai/context.js';

import { chatWithAILogic } from './ai/chatWithAI.logic';
import { editWithAILogic } from './ai/editWithAI.logic';
import { embedDocumentLogic } from './ai/embedDocument.logic';
import { extractChatMemoryLogic } from './ai/extractChatMemory.logic';
import { getAIUsageStatsLogic } from './ai/getAIUsageStats.logic';
import { judgeBeliefCandidateLogic } from './ai/judgeBeliefCandidate.logic';
import { judgeFacetsLogic } from './ai/judgeFacets.logic';
import { rerankNotesLogic } from './ai/rerankNotes.logic';
import { summarizeBeliefClusterLogic } from './ai/summarizeBeliefCluster.logic';
import { summarizeDocumentLogic } from './ai/summarizeDocument.logic';
import { summarizeFacetLogic } from './ai/summarizeFacet.logic';
import { validateCustomPromptLogic } from './ai/validateCustomPrompt.logic';
import { deriveTaxonomyLogic } from './ai/deriveTaxonomy.logic';
import { sendTelemetryLogic, deleteAccountLogic } from './account';

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
  sendTelemetry: sendTelemetryLogic,
  deleteAccount: deleteAccountLogic,
};

const CODE_TO_HTTP: Record<string, number> = {
  'unauthenticated': 401,
  'permission-denied': 403,
  'invalid-argument': 400,
  'resource-exhausted': 429,
  'internal': 500,
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
  const logicFn = LOGIC_MAP[endpoint];
  if (!logicFn) {
    return { status: 404, body: { error: `AI endpoint '${endpoint}' not found.` } };
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
      return { status, body: { error: { code: e.code, message: e.message } } };
    }
    console.error(`[api/handlers] unhandled error in ${endpoint}:`, e);
    return { status: 500, body: { error: { code: 'internal', message: 'Internal server error.' } } };
  }
}
