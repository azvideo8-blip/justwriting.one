export const INJECTION_PATTERNS = [
  /ignore\s+previous/i,
  /ignore\s+instructions/i,
  /jailbreak/i,
  /\bDAN\b/i,
  /you\s+are\s+now/i,
  /forget\s+your/i,
  /новые\s+инструкции/i,
  /забудь/i,
];

export function hasInjectionAttempt(text: string): boolean {
  return INJECTION_PATTERNS.some(p => p.test(text));
}
