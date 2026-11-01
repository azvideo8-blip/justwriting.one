# Security Invariants

Centralized rules that MUST hold at all times. Each invariant has one enforcement point.

**Acceptance rule (N1-6, 01.11.2026).** Every section names how its rule holds: `structural`
(schema, grants, a single writer, an explicit prohibition in code covered by a test) or `timing`
(a generation counter, a debounce, "the write happens to land first", effect order). A `timing`
protection is NOT proof that the invariant holds. At acceptance it must either be replaced by a
`structural` enforcement or be named in the report as an assumption, with the window it leaves open.
`timing` is how several draft losses survived every review so far — see section 6.

The stack changed in August 2026: the access rules that lived in `firestore.rules` and
the callables that lived in `functions/` are gone. What follows names where each rule is
enforced now. `docs/AUDIT_PLAYBOOK.md` Section 1 is the checklist version of this page.

## 1. AI Rate Limits — `src/shared/ai/aiPolicy.ts` + `api/postgresAiContext.ts`

- **Invariant:** Only server-validated `callType` can skip the per-user quota. No client-supplied flag can bypass limits.
- **Enforcement:** `validateInternalCallRestrictions()` in `src/shared/ai/aiPolicy.ts` — called by `api/ai/chatWithAI.logic.ts` and by the streaming path in `api/chat.ts`. A `callType` is the only way past the daily chat cap, so it is also the most client-shaped flag on the request (EA-1): it cannot carry a custom persona, reasoning, document content, a user portrait, more than 3 (12 for `system_task`) messages or more than `INTERNAL_CALL_MAX_INPUT_CHARS` of text, and its system prompt comes only from `isAllowedSystemTaskPrompt` — `src/shared/ai/systemTaskPrompts.ts`, never from the caller.
- **Global guard:** `tryReserveGlobalRequest()` / `refundGlobalRequest()` (`api/postgresAiContext.ts`), a single `INSERT … ON CONFLICT … WHERE call_count < $limit` over `public.ai_global_daily` (`0004_ai_counters.sql`, `0005_ai_global_daily_tokens.sql`). It applies even to internal calls; refunded when the provider produced nothing (`src/shared/ai/aiPolicy.ts` `SettleReason`, `REFUND_IF_PRODUCED_UNDER_CHARS`).
- **Per-user cap / background window:** `checkDailyLimit` and `checkAndIncrementBulkLimit` in `api/postgresAiContext.ts` — one transaction, one connection (R10-8).
- **Test:** `api/__tests__/chatWithAILimits.test.ts`, `api/__tests__/internalCallLimitsDA2.test.ts`, `api/__tests__/injectionRefund.test.ts`, `api/__tests__/reservationLifetime.test.ts`, `api/__tests__/charge.test.ts`. Those mock the pool and assert on the SQL text that reached it; the only one that runs against a real Postgres is `api/__tests__/aiPoolDeadlock.db.test.ts` (gates.yml step 3, `JW_THROWAWAY_DB=1`).
- **Canary:** none. Postulate 3 of the matrix (`scripts/postulates.mjs`) does not measure quota: `evaluateP3` in `src/testing/faultHarness/lifecycleRunner.ts` only checks `aiCallsIntercepted.length === 0`, i.e. that the sync/vault scenarios made no unsolicited AI call. Those scenarios never send an AI request on purpose, so it cannot see a `callType` bypass or a missed charge. Quota and `callType` are guarded only by the tests above plus `api/__tests__/postgresQuota.test.ts` (global token reserve), `api/__tests__/internalCallRefund.test.ts` (internal-call refund) and `src/shared/ai/__tests__/systemTaskWhitelist.test.ts` (EA-1 prompt whitelist).
- **Holds by:** `structural` — the cap is a single `INSERT … ON CONFLICT … WHERE call_count < $limit` in the database, so a bypass has to win a SQL predicate, not a client flag. The `callType` shape limits are also structural (whitelist + fixed prompt source). One caveat: the tests mock the pool and read the SQL text, so the shape of the query is verified, its behaviour is verified only by `aiPoolDeadlock.db.test.ts`.

## 2. Encryption Cloud Write — `src/core/crypto/cryptoHelpers.ts`

- **Invariant:** Never write unencrypted content to cloud when encryption is configured and vault is locked.
- **Enforcement:** `maybeEncrypt(doc, fields, arrayFields, userId)` is the single chokepoint — every cloud write of user content goes through it (every `maybeEncrypt(` call in `CloudSyncService.ts` passes `userId`). When `getEncryptionEnabled(userId)` is true and the session key is missing (vault locked), it throws `ENCRYPT_REQUIRED` instead of writing plaintext (`cryptoHelpers.ts`).
- **Root cause of C-ENC-1:** `lockVault` called `setEncryptionEnabled(false)`, which made `maybeEncrypt` skip encryption. Fixed by removing that call — `encryptionEnabled` is now a persistent property, not a transient state.
- **Test:** `src/core/__tests__/cryptoHelpers.test.ts` — "requires encryption when enabled for user and session key missing" asserts `ENCRYPT_REQUIRED` is thrown (reverting the `if (required) throw` branch turns it red).
- **Row flag invariant (documents):** `_encrypted` is one flag for the whole row, so a row marked encrypted carries no plaintext in `title`, `tags`, `mood`, and a row not marked encrypted carries no ciphertext. Metadata edits are partial (tags alone, title alone, mood alone), so a patch with ciphertext may land only on a row that is already encrypted as a whole. **Enforcement:** `writeDocumentPatch` in `src/core/data/providers/documents.ts` — the only write path behind `updateDocument` and `updateDocumentSessionStats`. It writes with `_encrypted = true` as a condition; if nothing matched and the row is a plaintext one (created before the vault, never migrated), the rest of the row is encrypted in the same request. Before this, `updateTags` on such a row left the title in plaintext under an «encrypted» flag: the row read as «Не удалось прочитать», and the migration skipped it because the flag was already set. **Test:** `src/core/services/__tests__/partialMetadataOnPlaintextRow.test.ts` (rows are seeded by hand in their pre-vault shape; red on the old code).
- **Finding rows that already break it** (read-only; AES-GCM ciphertext in base64 is at least 40 characters):

  ```sql
  with shape as (
    select uuid, user_id, _encrypted,
           title ~ '^[A-Za-z0-9+/]{38,}={0,2}$'                          as title_sealed,
           jsonb_typeof(tags) = 'string'                                 as tags_sealed,
           coalesce(mood ~ '^[A-Za-z0-9+/]{38,}={0,2}$', false)          as mood_sealed,
           jsonb_typeof(tags) = 'array' and jsonb_array_length(tags) > 0 as tags_plain_text,
           mood is not null and mood !~ '^[A-Za-z0-9+/]{38,}={0,2}$'     as mood_plain_text
    from documents
    where deleted_at is null
  )
  select uuid,
         case
           when _encrypted and not title_sealed                     then 'A-unreadable: title is not ciphertext on an encrypted row'
           when _encrypted and (tags_plain_text or mood_plain_text) then 'A-leak: plaintext tags or mood on an encrypted row'
           when _encrypted and not tags_sealed                      then 'A-benign: empty tags array on an encrypted row'
           when not _encrypted and (title_sealed or tags_sealed or mood_sealed) then 'B-unreadable: ciphertext on a row not marked encrypted'
         end as kind
  from shape
  where (_encrypted and (not title_sealed or not tags_sealed or mood_plain_text))
     or (not _encrypted and (title_sealed or tags_sealed or mood_sealed))
  order by kind, uuid;
  ```

  A plaintext emoji in `mood` on an encrypted row is a known older state that the read path tolerates (AG-ENC-1); the query reports it as `A-leak`. The fix does not repair rows that are already mixed.
- **Holds by:** `structural` — the rule is an explicit `throw ENCRYPT_REQUIRED` at one chokepoint that every cloud write of user content passes, plus a column condition inside the only document-patch write path. Nothing in it depends on ordering or on a counter. The residue is `timing` in one place only: a vault that is unlocked at the moment of the write encrypts, so the invariant reads the *session* key state, and `encryptionEnabled` is a persistent flag precisely because the transient one used to be wrong (C-ENC-1 above).

## 3. Row-Level Security — `supabase/migrations/0002_rls.sql`

- **Invariant:** Per-user access is scoped to the authenticated uid; `role`/`uid`/`email` are not client-writable; server-only tables are closed.
- **Enforcement:** `supabase/migrations/0002_rls.sql` holds the policies — per-user rows are scoped by `auth.uid()` (30 mentions across the file's 38 policies); what does not name `auth.uid()` is either an admin lookup or an explicit denial, never a gap. Admin rights go through `public.is_admin()`, added by `supabase/migrations/0017_admin_rls_lookup.sql`; it is `security definer` with `search_path = ''` precisely because a policy on `public.users` that reads `public.users` would recurse into RLS. Column immutability is a trigger, not a policy: `public.protect_user_columns()` (`0001_schema.sql`) rejects `role`/`uid` changes, and `0015_server_controlled_columns.sql` adds `email` while still allowing the `auth.users` sync path. Server-controlled tables are closed by enabling RLS with no policy — `public.applied_migrations` (`0015:11-16`); the former telemetry tables were dropped outright by `supabase/migrations/0036_drop_telemetry.sql`.
- **Test:** `supabase/tests/rls.test.sql` against a throwaway Postgres (CI: `.github/workflows/ci.yml` job `rls`, `.github/workflows/gates.yml` step «3. Live database checks»); `supabase/tests/e2e-rls.sh` against the real stack on the server, which is the only check that sees a JWT reaching those policies and the role grants beneath them.
- **Applies:** `bash supabase/scripts/migrate.sh --status` must show no `[PENDING]` — a policy that exists only in a file protects nobody (`docs/AUDIT_PLAYBOOK.md`, Pre-flight).
- **Holds by:** `structural` — policies, triggers and grants live in the database, below the application, so no client ordering, cache state or retry can step around them. The `timing` risk is deployment only: the policies are files until `migrate.sh` applies them (bullet above), which is why the acceptance checklist names `--status` rather than the merge.

## 4. AI Input Sanitization + Injection Check — `src/shared/ai/`

- **Invariant:** All user-supplied content (messages, `customSystemPrompt`, note-derived fields) reaches the model only after sanitization, and content that reads as a direct instruction is rejected before the provider call.
- **Enforcement:** `sanitizeAiInputShared()` (`src/shared/ai/buildChatPrompt.ts`) applied at prompt assembly (`assembleChatPromptParams` — `customSystemPrompt`, `userPortrait`, `memoryContext`, `documentContent`, `documentMood`) and per message on the stream (`api/chat.ts`). The injection list is ONE array: `INJECTION_PATTERNS` in `src/shared/ai/injectionPatterns.ts` (16 Latin + 5 Cyrillic patterns, checked against a homoglyph-folded copy for the Latin set and the original text for the Cyrillic set) — re-exported to `api/` through `api/ai/pure.ts`, whose `sanitizeAiInput()` is a thin delegate (`api/ai/pure.ts`). There is no second copy to drift from: the old `functions/` list was deleted with Firebase.
- **Also enforced:** `assertNoSystemPromptInjection()` (`src/shared/ai/aiPolicy.ts`) in both `api/chat.ts` and `api/ai/chatWithAI.logic.ts`; `hasInjectionAttempt()` rejects model-derived text that would re-enter a prompt (`api/ai/extractChatMemory.logic.ts`, `api/ai/summarizeFacet.logic.ts`, `api/ai/validateCustomPrompt.logic.ts`).
- **Test:** `src/shared/ai/__tests__/invisibleChars.test.ts`, `api/__tests__/noteInjectionFence.test.ts`, `api/__tests__/noteInjectionDA12.test.ts`.
- **Holds by:** the chokepoint is `structural` (one array, one delegate into `api/`, sanitization applied where the prompt is assembled — the old second copy was deleted with Firebase). The list of patterns inside it is a heuristic, not a structural boundary: a phrasing nobody has seen escapes it. Named as an assumption rather than counted as proof.

## 5. AI Output Sanitization — `src/features/ai/components/MarkdownRenderer.tsx` + `api/ai/pure.ts`

- **Invariant:** Model output cannot inject markup into the page.
- **Enforcement:** Custom `SANITIZE_SCHEMA` in `MarkdownRenderer.tsx` (`rehype-sanitize`; `img` is not in the allowed set and `rehype-raw` is deliberately absent).
- **Defense-in-depth:** non-streaming callables run the text through `sanitizeAiResponse()` (`api/ai/pure.ts`, `isomorphic-dompurify`) before it is stored or compared. The streaming path does not: `api/chat.ts` sanitizes what goes IN (per message, before the provider call) and relies on client-side `rehypeSanitize` for what comes OUT — which is why the schema above is load-bearing and `rehype-raw` staying out is an invariant, not a style preference.
- **Test:** none. No test file and no postulate canary references `MarkdownRenderer`, `SANITIZE_SCHEMA` or `rehype` (`grep -rl "MarkdownRenderer\|SANITIZE_SCHEMA\|rehype" src api scripts | grep -i "test\|postulate"` → пусто). This is the one invariant on this page whose enforcement point is untested, and ADR-0001 leans on it: `docs/adr/0001-supabase-session-in-localstorage.md` names client-side `rehype-sanitize` as the mitigation that bounds a stolen session token.
- **Holds by:** `structural` by construction (an allowlist schema; anything not listed cannot render), and the structural part is NOT covered by a test — see the bullet above. Under the acceptance rule this section is accepted as «structural, untested»: the absence of `rehype-raw` is a code fact, not a timing assumption, but nobody reddens if someone adds it back.

## 6. Draft writers — `src/features/writing/**`

The map of the writers (14 writers of draft text, 15 deletions, six generation bumps, three
reads at load that write themselves) is `justwriting-docs/report-2026-11-01-draft-writers.md` §1;
the invariants are its §2.1, and I6 was added by ticket DW-9. For each invariant below: where it
holds, which test proves it, and whether it holds `structural` or `timing`.

- **I1 — typed and unsaved text survives a reload, a killed tab and a lost network.**
  - Holds in: local debounce write `src/features/writing/hooks/useDraftAutosave.ts:255-264`;
    30-second cloud insurance `:271-276`; synchronous copy at tab close
    `src/features/writing/hooks/useDraftCore.ts:202-284` (`beforeunload` and `pagehide`);
    on load the NEWER of the two local copies wins — `pickNewerLocalCopy`
    `src/features/writing/services/WritingDraftService.ts:230-266`, called at `:485` (N1-4);
    guest path `src/features/writing/services/GuestDraftService.ts:36-62` (write) and `:63-100` (read that caches).
  - Proven by: `src/features/writing/services/__tests__/draftUnloadCopyNewer.n14.test.ts`,
    `src/features/writing/hooks/__tests__/draftUnmountSave.as1.test.ts`,
    `src/features/writing/__tests__/draftWritersFuzz.dw3.test.ts` (28 seeds in CI; a 400-seed
    sweep is a manual gate), `e2e/mobile/draft-banner.mq3.spec.ts` (the draft is still there
    after a phone reload).
  - **Holds by: `timing`.** The guarantee is «a write lands before the tab dies». Two documented
    windows stay open: text typed after the 1500 ms flush limit
    (`src/core/auth/accountReload.ts:15,61-67`) is not persisted (F-3 #4, accepted as «by
    design» in `report-2026-10-18-SYNC0`), and DW-10-F-1 (`it.fails`) is an account switch
    inside an unclosed save. Neither is closed by a structural rule yet.

- **I2 — text closed by a confirmed save never comes back as a draft.**
  - Holds in: generation counter (`getDraftGeneration`/`bumpDraftGeneration`), every writer must
    name the generation it edited under — `src/features/writing/utils/draftPersistence.ts:50-56`
    and the checks at `WritingDraftService.ts:566,571,593,660,672,679`; unload veto
    `useDraftAutosave.ts:221-225` passed into `useSyncUnloadSave` (`:227`); deleting the draft
    clears BOTH addresses — `WritingDraftService.ts:370` (IndexedDB row + `draft-<uid>`) and
    `clearLegacyDraft` `:553-556`, called by `useSessionPersistence.ts:109`.
  - Proven by: `src/features/writing/hooks/__tests__/draftAfterSaveWindow.dy1010.test.ts`,
    harness test «окно DY10-10», `e2e/mobile/draft-after-save.dy1010.spec.ts`,
    `src/features/writing/services/__tests__/draftUnloadCopyNewer.n14.test.ts` («сохранение
    стирает LS-ключ до чтения»).
  - **Holds by: `timing`.** A counter is not a schema rule, and it fails open: a caller that
    names no generation writes unchecked (`WritingDraftService.ts:566` — `generation !==
    undefined`), which is deliberate after DY10-10. Under the acceptance rule this is an
    assumption, and step 5 of the DW-4 plan is what makes it structural (the mutator owns the
    epoch).

- **I3 — one account's text is never written into another account's draft.**
  - Holds in: database per uid, `getLocalDbName` `src/core/storage/localDb.ts:741-751`; the
    draft row's own `userId` decides the target DB; editor-text owner
    `src/features/writing/utils/draftOwnerGuard.ts:21-35` (`mayAccountWriteEditorText`) and
    `:47` (`markEditorTextOwnedBy`), stamped when the text changes
    (`useDraftAutosave.ts:89-99`); the auth provider refuses to adopt a new account without a
    page reload — mirror `src/core/auth/supabaseAuthProvider.ts:74-77`, listeners `:105`.
  - Proven by: `src/core/auth/__tests__/providerAccountSwitchBan.n16.test.ts` (added in N1-6:
    removing the early return reddens it), `src/features/auth/__tests__/accountIsolation.test.ts`,
    harness DW-9 seeds 191/266, `src/features/writing/hooks/__tests__/draftSessionStaleLoad.dw7.test.tsx`,
    `e2e/accountSwitch.spec.ts`.
  - **Holds by: `structural` for storage naming and for the provider ban** (explicit prohibition,
    now covered by a test); **`timing` for the text owner** — the owner is stamped by an effect
    on text change, so the window «store holds text, owner is not stamped» is what DW-F-3
    observed (seeds 565/183) and what step 4 of the DW-4 plan closes by putting `owner` in the
    row itself.

- **I4 — guest text becomes an account note at sign-in instead of disappearing.**
  - Holds in: `src/features/auth/services/migrateDocuments.ts:30-44` (newest of the two guest
    addresses, `GUEST_DRAFT_TTL_MS` check at `:43`), `:66-74` with the explicit guard
    `!existingUserDraft` (`:68-69`); guest writers
    `src/features/writing/services/GuestDraftService.ts:36-62`.
  - Proven by: `src/features/auth/__tests__/migration.test.ts`,
    `src/features/auth/services/__tests__/migrateDraftConsumed.test.ts`,
    `src/features/writing/services/__tests__/GuestDraftService.test.ts`, harness I4 over 12 guest seeds.
  - **Holds by: `structural`** for the single migration entrance and the `!existingUserDraft`
    guard; `timing` for the 7-day TTL, which reads the device clock (`:43`) — an expired guest
    draft is not migrated *and* not deleted (D13 in the map), which is an accepted gap, not a proof.

- **I5 — a deleted draft does not come back from another device.**
  - Holds in: tombstone with the hashes of the deleted content
    `WritingDraftService.ts:285` (`writeTombstone`), compared by content at `:416-422`;
    the pending-cloud-delete mark is set in the local half (`:358`), read for the re-send
    (`:305`) and cleared on either side (`:293`, `:379`), and the re-send runs at load
    (`:423` `flushPendingCloudDelete`).
  - Proven by: `draftTombstone.ap2-4.test.ts`, `draftTombstoneServerClock.d1-2.test.ts`,
    `draftUnsentEdits.sf21.test.ts`, `draftOfflineFinishKeepsNewDraft.br1.test.ts`,
    `draftExpiryServerClock.d1-6.test.ts`, harness I5.
  - **Holds by: `structural`** where it counts (a hash match is a content identity, not a clock),
    with the clock branch deliberately narrowed to device-stamped rows only (D1-2), so
    `timing` remains in the «we did not read a hash → decide by time» fallback.

- **I6 — the draft row always knows who owns its text; «no owner» is not «the current account».**
  - Holds in: `draftOwnerGuard.ts:21-47` (both writer checks come from this one helper),
    stamped at edit time `useDraftAutosave.ts:89-99`, read by the unload writer (`:227`) and by
    the unmount/rescue path (`:111-148`).
  - Proven by: harness DW-9 seeds 191 and 266, `useDraftAutosave.test.ts`,
    `draftSessionStaleLoad.dw7.test.tsx`.
  - **Holds by: `timing`.** DW-9 moved the stamp from «after the debounce» to «when the text
    changes», which shrinks the window; it does not remove it. The structural version is the
    `owner` field of the row (DW-4 step 4).

### 6.1 Timing protections this page currently relies on

Per the acceptance rule at the top, these are named as assumptions, not as evidence:

- Generation check at the rescue writer (DW-10): `useDraftAutosave.ts:111-148` reads the
  PREVIOUS owner's generation. Measured in `justwriting-docs/report-2026-11-02-dw-fixes-2.md` §2:
  removing the comparison leaves `src/features/writing` (755 tests then) and the 400-seed sweep
  green both with and without it — so nothing proves this branch, and it was left in place
  deliberately rather than weakened further.
- «The leaving account finishes writing before the reload» (DW-F-3): the flush is bounded by
  `FLUSH_LIMIT_MS = 1500` (`src/core/auth/accountReload.ts:15,61-67`). If the write is slower,
  the text lives only on the screen. Measured in the same §2: probe `World(9_566)` (no reload
  planned — the write lands) versus the directed DW-F-3 test (reload planned — neither account's
  row holds the text at the moment of observation).
- Provider ban on switching accounts without a reload: `supabaseAuthProvider.ts:74-77,105`.
  This one is no longer an assumption — `providerAccountSwitchBan.n16.test.ts` reddens when the
  early return is removed, so it is `structural`.
- Guest writes have no generation at all (owner decision, 31.10: «окно миллисекундное») —
  `GuestDraftService` vs `useSyncUnloadSave`, harness finding DW-F-2.
