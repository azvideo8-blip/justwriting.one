// Centralized AI security policy — single source of truth for:
// - What constitutes an internal call (and what restrictions apply)
// - Which paths bypass per-user quota (and why)
// - The global guard that always applies
//
// All AI endpoints MUST use these helpers instead of inline checks.
// This prevents the C1-style bypass where a client flag silently disabled limits.

export type InternalCallType = 'auto_name' | 'follow_up' | 'query_expand';

export interface InternalCallRestrictions {
  maxTokens: number;
  maxMessages: number;
  noCustomPersona: boolean;
  noReasoning: boolean;
  noDocumentContent: boolean;
  noUserPortrait: boolean;
}

// The restrictions that apply to all internal calls. These make internal calls
// unattractive for abuse: low token budget, no rich context, no custom persona.
export const INTERNAL_CALL_RESTRICTIONS: InternalCallRestrictions = {
  maxTokens: 256,
  maxMessages: 3,
  noCustomPersona: true,
  noReasoning: true,
  noDocumentContent: true,
  noUserPortrait: true,
};

export function isInternalCall(callType: InternalCallType | null | undefined): boolean {
  return callType !== undefined && callType !== null;
}

// Validate that an internal call respects its restrictions.
// Throws HttpsError-compatible error if violated.
export function validateInternalCallRestrictions(params: {
  callType: InternalCallType | null | undefined;
  personaId: string;
  reasoning?: boolean | null;
  documentContent?: string | null;
  userPortrait?: string | null;
  messages: unknown[];
}): { isInternal: boolean } {
  const isInternal = isInternalCall(params.callType);
  if (!isInternal) return { isInternal: false };

  const r = INTERNAL_CALL_RESTRICTIONS;
  const err = (msg: string) => ({ code: 'invalid-argument', message: msg });

  if (r.noCustomPersona && params.personaId === 'custom') {
    throw err('Custom persona not allowed for internal calls.');
  }
  if (r.noReasoning && params.reasoning === true) {
    throw err('Reasoning mode not allowed for internal calls.');
  }
  if (r.noDocumentContent && params.documentContent) {
    throw err('Document content not allowed for internal calls.');
  }
  if (r.noUserPortrait && params.userPortrait) {
    throw err('User portrait not allowed for internal calls.');
  }
  if (params.messages.length > r.maxMessages) {
    throw err(`Too many messages for internal call (max ${r.maxMessages}).`);
  }

  return { isInternal: true };
}

// The max token budget for a given call.
export function getMaxTokens(isInternal: boolean, reasoning: boolean | null | undefined): number {
  if (isInternal) return INTERNAL_CALL_RESTRICTIONS.maxTokens;
  return reasoning ? 16384 : 8192;
}
