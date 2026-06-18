// SECURITY: Shared injection pattern list — imported by both api/chat.ts
// (Vercel Edge) and functions/src/shared/aiUtils.ts (Cloud Functions).
// Do NOT add patterns locally in either file — update this file only.

export const INJECTION_PATTERNS = [
  /ignore\s+previous/i,
  /ignore\s+instructions/i,
  /jailbreak/i,
  /\bDAN\b/i,
  /you\s+are\s+now/i,
  /forget\s+your/i,
  /новые\s+инструкции/i,
  /забудь/i,
  /system\s*:/i,
  /as\s+an\s+AI/i,
  /developer\s*:/i,
  /<\|im_start\|>/i,
  /\[INST\]/i,
  /<developer>/i,
  /<end_of_turn>/i,
];

export function hasInjectionAttempt(text: string): boolean {
  return INJECTION_PATTERNS.some(p => p.test(text));
}
