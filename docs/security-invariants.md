# Security Invariants

Centralized rules that MUST hold at all times. Each invariant has one enforcement point.

## 1. AI Rate Limits — `functions/src/shared/aiPolicy.ts`

- **Invariant:** Only server-validated `callType` can skip per-user quota. No client-supplied flag can bypass limits.
- **Enforcement:** `validateInternalCallRestrictions()` in `aiPolicy.ts` — called by `chatWithAI` and `api/chat.ts`.
- **Global guard:** `tryReserveGlobalRequest()` always applies, even for internal calls. `refundGlobalRequest()` on failure.
- **Test:** `functions/src/__tests__/emulator/aiUtils.emulator.test.ts` — race + refund tests.

## 2. Encryption Cloud Write — `src/core/crypto/encryptionGuard.ts`

- **Invariant:** Never write unencrypted content to cloud when encryption is configured and vault is locked.
- **Enforcement:** `assertCloudWriteSafe(encryptionEnabled)` — call before any cloud write of user content.
- **Root cause of C-ENC-1:** `lockVault` called `setEncryptionEnabled(false)`, which made `maybeEncrypt` skip encryption. Fixed by removing that call — `encryptionEnabled` is now a persistent property, not a transient state.
- **Test:** Manual — lock vault, attempt save, verify `ENCRYPT_REQUIRED` error (not silent plaintext write).

## 3. Firestore Rules — `firestore.rules`

- **Invariant:** `userId == request.auth.uid` in all document create validators. `role`/`uid`/`email` not client-writable. Telemetry is create-only.
- **Enforcement:** `firestore.rules` — tested by `functions/src/__tests__/rules.test.ts`.
- **Test:** `npm run test:rules` (requires Firestore emulator).

## 4. AI Input Sanitization — `functions/src/shared/aiUtils.ts` + `src/shared/ai/buildChatPrompt.ts`

- **Invariant:** All user-supplied content (messages, customSystemPrompt, documentContent) is sanitized and checked against injection patterns before reaching the model.
- **Enforcement:** `sanitizeAiInput()` + `INJECTION_PATTERNS` check in each endpoint.
- **Parity:** `sanitizeAiInputShared` in `buildChatPrompt.ts` mirrors the Cloud Functions version (9 patterns).

## 5. AI Output Sanitization — `src/features/ai/components/MarkdownRenderer.tsx`

- **Invariant:** AI output is sanitized — `img` tags stripped, no `rehype-raw`, only safe tags allowed.
- **Enforcement:** Custom `SANITIZE_SCHEMA` in `MarkdownRenderer.tsx`.
- **Defense-in-depth:** Cloud Functions also use `sanitizeAiResponse` (DOMPurify). Streaming path relies on client-side sanitization only.
