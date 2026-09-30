# Security Invariants

Centralized rules that MUST hold at all times. Each invariant has one enforcement point.

The stack changed in August 2026: the access rules that lived in `firestore.rules` and
the callables that lived in `functions/` are gone. What follows names where each rule is
enforced now. `docs/AUDIT_PLAYBOOK.md` Section 1 is the checklist version of this page.

## 1. AI Rate Limits — `src/shared/ai/aiPolicy.ts` + `api/postgresAiContext.ts`

- **Invariant:** Only server-validated `callType` can skip the per-user quota. No client-supplied flag can bypass limits.
- **Enforcement:** `validateInternalCallRestrictions()` in `src/shared/ai/aiPolicy.ts` — called by `api/ai/chatWithAI.logic.ts` and by the streaming path in `api/chat.ts`. A `callType` is the only way past the daily chat cap, so it is also the most client-shaped flag on the request (EA-1): it cannot carry a custom persona, reasoning, document content, a user portrait, more than 3 (12 for `system_task`) messages or more than `INTERNAL_CALL_MAX_INPUT_CHARS` of text, and its system prompt comes only from `isAllowedSystemTaskPrompt` — `src/shared/ai/systemTaskPrompts.ts`, never from the caller.
- **Global guard:** `tryReserveGlobalRequest()` / `refundGlobalRequest()` (`api/postgresAiContext.ts`), a single `INSERT … ON CONFLICT … WHERE call_count < $limit` over `public.ai_global_daily` (`0004_ai_counters.sql`, `0005_ai_global_daily_tokens.sql`). It applies even to internal calls; refunded when the provider produced nothing (`src/shared/ai/aiPolicy.ts` `SettleReason`, `REFUND_IF_PRODUCED_UNDER_CHARS`).
- **Per-user cap / background window:** `checkDailyLimit` and `checkAndIncrementBulkLimit` in `api/postgresAiContext.ts` — one transaction, one connection (R10-8).
- **Test:** `api/__tests__/chatWithAILimits.test.ts`, `api/__tests__/internalCallLimitsDA2.test.ts`, `api/__tests__/injectionRefund.test.ts`, `api/__tests__/reservationLifetime.test.ts`, `api/__tests__/charge.test.ts`. Those mock the pool and assert on the SQL text that reached it; the only one that runs against a real Postgres is `api/__tests__/aiPoolDeadlock.db.test.ts` (gates.yml step 3, `JW_THROWAWAY_DB=1`).
- **Canary:** postulate 9 (`scripts/postulates.mjs`, id `postulate-09-ai-quota`) asserts the server — `api/postgresAiContext.ts` and `src/shared/ai/aiPolicy.ts` — is the only enforcement point, and that no client file both checks the quota limit and sends a request.

## 2. Encryption Cloud Write — `src/core/crypto/cryptoHelpers.ts`

- **Invariant:** Never write unencrypted content to cloud when encryption is configured and vault is locked.
- **Enforcement:** `maybeEncrypt(doc, fields, arrayFields, userId)` is the single chokepoint — every cloud write of user content goes through it (every `maybeEncrypt(` call in `CloudSyncService.ts` passes `userId`). When `getEncryptionEnabled(userId)` is true and the session key is missing (vault locked), it throws `ENCRYPT_REQUIRED` instead of writing plaintext (`cryptoHelpers.ts`).
- **Root cause of C-ENC-1:** `lockVault` called `setEncryptionEnabled(false)`, which made `maybeEncrypt` skip encryption. Fixed by removing that call — `encryptionEnabled` is now a persistent property, not a transient state.
- **Test:** `src/core/__tests__/cryptoHelpers.test.ts` — "requires encryption when enabled for user and session key missing" asserts `ENCRYPT_REQUIRED` is thrown (reverting the `if (required) throw` branch turns it red).

## 3. Row-Level Security — `supabase/migrations/0002_rls.sql`

- **Invariant:** Per-user access is scoped to the authenticated uid; `role`/`uid`/`email` are not client-writable; telemetry is not client-writable at all; server-only tables are closed.
- **Enforcement:** `supabase/migrations/0002_rls.sql` holds the policies — per-user rows are scoped by `auth.uid()` (30 mentions across the file's 38 policies); what does not name `auth.uid()` is either an admin lookup or an explicit denial, never a gap. Admin rights go through `public.is_admin()`, added by `supabase/migrations/0017_admin_rls_lookup.sql`; it is `security definer` with `search_path = ''` precisely because a policy on `public.users` that reads `public.users` would recurse into RLS. Column immutability is a trigger, not a policy: `public.protect_user_columns()` (`0001_schema.sql`) rejects `role`/`uid` changes, and `0015_server_controlled_columns.sql` adds `email` while still allowing the `auth.users` sync path. Server-controlled tables are closed by enabling RLS with no policy — `public.applied_migrations` (`0015:11-16`), `anonymized_telemetry` insert/update/delete denied by `telemetry_deny_write` / `telemetry_deny_update` (`0002_rls.sql`) — the old "create-only telemetry" rule is dead: the API writes telemetry, the client writes nothing.
- **Test:** `supabase/tests/rls.test.sql` against a throwaway Postgres (CI: `.github/workflows/ci.yml` job `rls`, `.github/workflows/gates.yml` step «3. Live database checks»); `supabase/tests/e2e-rls.sh` against the real stack on the server, which is the only check that sees a JWT reaching those policies and the role grants beneath them.
- **Applies:** `bash supabase/scripts/migrate.sh --status` must show no `[PENDING]` — a policy that exists only in a file protects nobody (`docs/AUDIT_PLAYBOOK.md`, Pre-flight).

## 4. AI Input Sanitization + Injection Check — `src/shared/ai/`

- **Invariant:** All user-supplied content (messages, `customSystemPrompt`, note-derived fields) reaches the model only after sanitization, and content that reads as a direct instruction is rejected before the provider call.
- **Enforcement:** `sanitizeAiInputShared()` (`src/shared/ai/buildChatPrompt.ts`) applied at prompt assembly (`assembleChatPromptParams` — `customSystemPrompt`, `userPortrait`, `memoryContext`, `documentContent`, `documentMood`) and per message on the stream (`api/chat.ts`). The injection list is ONE array: `INJECTION_PATTERNS` in `src/shared/ai/injectionPatterns.ts` (16 Latin + 5 Cyrillic patterns, checked against a homoglyph-folded copy for the Latin set and the original text for the Cyrillic set) — re-exported to `api/` through `api/ai/pure.ts`, whose `sanitizeAiInput()` is a thin delegate (`api/ai/pure.ts`). There is no second copy to drift from: the old `functions/` list was deleted with Firebase.
- **Also enforced:** `assertNoSystemPromptInjection()` (`src/shared/ai/aiPolicy.ts`) in both `api/chat.ts` and `api/ai/chatWithAI.logic.ts`; `hasInjectionAttempt()` rejects model-derived text that would re-enter a prompt (`api/ai/extractChatMemory.logic.ts`, `api/ai/summarizeFacet.logic.ts`, `api/ai/validateCustomPrompt.logic.ts`).
- **Test:** `src/shared/ai/__tests__/invisibleChars.test.ts`, `api/__tests__/noteInjectionFence.test.ts`, `api/__tests__/noteInjectionDA12.test.ts`.

## 5. AI Output Sanitization — `src/features/ai/components/MarkdownRenderer.tsx` + `api/ai/pure.ts`

- **Invariant:** Model output cannot inject markup into the page.
- **Enforcement:** Custom `SANITIZE_SCHEMA` in `MarkdownRenderer.tsx` (`rehype-sanitize`; `img` is not in the allowed set and `rehype-raw` is deliberately absent).
- **Defense-in-depth:** non-streaming callables run the text through `sanitizeAiResponse()` (`api/ai/pure.ts`, `isomorphic-dompurify`) before it is stored or compared. The streaming path does not: `api/chat.ts` sanitizes what goes IN (per message, before the provider call) and relies on client-side `rehypeSanitize` for what comes OUT — which is why the schema above is load-bearing and `rehype-raw` staying out is an invariant, not a style preference.
- **Test:** none. No test file and no postulate canary references `MarkdownRenderer`, `SANITIZE_SCHEMA` or `rehype` (`grep -rl "MarkdownRenderer\|SANITIZE_SCHEMA\|rehype" src api scripts | grep -i "test\|postulate"` → пусто). This is the one invariant on this page whose enforcement point is untested, and ADR-0001 leans on it: `docs/adr/0001-supabase-session-in-localstorage.md` names client-side `rehype-sanitize` as the mitigation that bounds a stolen session token.
