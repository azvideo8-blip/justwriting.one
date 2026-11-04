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
  - Holds in: local debounce write `src/features/writing/hooks/useDraftAutosave.ts:344-357`;
    30-second cloud insurance `:302-307`; synchronous copy at tab close
    `src/features/writing/hooks/useDraftCore.ts:230-318` (`beforeunload` and `pagehide`);
    on load the NEWER of the two local copies wins — `pickNewerLocalCopy`
    `src/features/writing/services/WritingDraftService.ts:230-266`, called at `:485` (N1-4);
    guest path: both guest addresses are written by the mutator since DW4-2 —
    `GuestDraftService.saveGuestDraftToStorage` → `applyWrite` (`draftWriter.ts`), read
    `GuestDraftService.ts:63-100` (read that caches).
  - Proven by: `src/features/writing/services/__tests__/draftUnloadCopyNewer.n14.test.ts`,
    `src/features/writing/hooks/__tests__/draftUnmountSave.as1.test.ts`,
    `src/features/writing/__tests__/draftWritersFuzz.dw3.test.ts` (28 seeds in CI; a 400-seed
    sweep is a manual gate), `e2e/mobile/draft-banner.mq3.spec.ts` (the draft is still there
    after a phone reload).
  - **Holds by: `timing`.** The guarantee is «a write lands before the tab dies». One documented
    window stays open: text typed after the 1500 ms flush limit
    (`src/core/auth/accountReload.ts:15,61-67`) is not persisted (F-3 #4, accepted as «by
    design» in `report-2026-10-18-SYNC0`). The second window this section used to name —
    DW-10-F-1, an account switch inside an unclosed save — is closed by DW-4 step 5 and moved to
    I2 as `structural`; the rescue side of it is narrowed further by DW5-2 (§6.1).

- **I2 — text closed by a confirmed save never comes back as a draft.**
  - Holds in: since DW-4 step 5 the epoch belongs to the mutator end to end. Raising it is
    `applySave` `src/features/writing/services/draftWriter.ts:148` — the only raise in product
    code (a save was accepted, a draft was deleted or reset); leaving the editor raises
    `applySessionEnd` (`:155`). The last close is remembered separately from the counter because the fate of a
    refused write depends on it, and a session end right after a save must not erase it:
    `isDraftClosed` (`:163`) distinguishes «this text was closed by the person» from «the session
    ended». The epoch is a field of the row —
    `DraftRecord.epoch`, stamped by `buildLocalDraft`
    (`src/features/writing/utils/draftPersistence.ts:43`) from the value the writer took when
    the text changed — so a writer names the epoch **of its text**, never the epoch live at the
    moment of writing. The rule is one line (`isEpochStale`, `draftWriter.ts:176`: a record
    naming an older epoch is refused) and it is checked at four points in `applyWrite`: before
    any write (`:350`), after the database opens (`:366`), inside the row-write queue
    immediately before `put` (`:378` — deletions run outside that queue, DW5-3.3), and in the
    catch (`:400`). The cloud half uses the same epoch and the same rule
    (`src/features/writing/services/WritingDraftService.ts:669`) and refuses a row whose named
    owner is not the address (`:658`); `_lastCloudSignature` and the 60-second SF-2 corridor are
    kept (§4.4 — a quota brake, not an ordering guard). Deleting the draft clears BOTH
    addresses — `WritingDraftService.ts:384`/`:391` and `clearLegacyDraft` `:574-577`.
  - Proven by: `src/features/writing/hooks/__tests__/draftRescueStaleEpoch.dw51.test.ts` (the
    rescue of the previous owner inside the DY10-10 window touches neither `drafts` nor
    `draft-<uid>`; the guest deferral touches neither `jw_guest_draft` nor `guest_draft`),
    `src/features/writing/services/__tests__/draftWriteQueueEpoch.dw53.test.ts` (a write that
    passed the check and entered the queue cannot resurrect the row deleted behind its back),
    harness `DW-10-F-1` in `src/features/writing/__tests__/draftWritersFuzz.dw3.test.ts` — it
    was `it.fails` up to 0.11.5 and is an ordinary green test since this step (the acceptance
    of §4.3 row 5), `src/features/writing/hooks/__tests__/draftAfterSaveWindow.dy1010.test.ts`,
    `e2e/mobile/draft-after-save.dy1010.spec.ts`,
    `src/features/writing/services/__tests__/draftUnloadCopyNewer.n14.test.ts` («сохранение
    стирает LS-ключ до чтения»).
  - **Holds by: `structural`.** The decision is a field of the row, taken by the one writer that
    also raises it: an epoch older than the current one changes no address, whichever writer
    sent it and whenever. The fail-open case the previous version of this section named («a
    caller that names no generation writes unchecked») is gone for the text writers — the epoch
    travels in the record — and remains only for the bases that legitimately have no epoch of
    their own (`adopt-cloud`, `adopt-legacy`, `migrate-guest`, `expire`: they carry a copy that
    arrived from elsewhere, and naming a foreign epoch for them would refuse the very adoption
    step 1–3 exist for). What stays deliberately `timing` is the cloud quota brake: `_lastCloudSignature`
    and the 60-second corridor decide whether a write is *attempted*, never whether a closed
    text may be written.

- **I3 — one account's text is never written into another account's draft.**
  - Holds in: database per uid, `getLocalDbName` `src/core/storage/localDb.ts:741-751`; since
    DW4-4 the draft row carries `owner` and the mutator decides by it — `applyWrite` refuses a
    row whose named owner is not the target uid ('owner-mismatch', `draftWriter.ts:341-342`)
    before any address is touched; the owner is stamped from the editor mirror into every row
    (`buildLocalDraft` `draftPersistence.ts:36`, unload copy `useDraftCore.ts:264,293`); the
    editor mirror `src/features/writing/utils/draftOwnerGuard.ts:23-37`
    (`mayAccountWriteEditorText`) and `:49-66` (`markEditorTextOwnedBy`) refuses to adopt
    another account's buffer by typing; on an in-app account switch the editor is handed over
    EMPTY — `rescueForPreviousOwner` (`useDraftAutosave.ts:121-176`) snapshots the text, clears
    the store synchronously and writes the snapshot to the previous owner's base afterwards
    (DW-F-3 clear-at-switch); the auth provider refuses to adopt a new account without a page
    reload — mirror `src/core/auth/supabaseAuthProvider.ts:74-77`, listeners `:105`.
  - Proven by: mutations removing the owner read in `applyWrite` redden the row-level cases
    (`expected 'written' to be 'owner-mismatch'`; outputs in
    `justwriting-docs/report-2026-11-03-dw4-4.md`), `src/core/auth/__tests__/providerAccountSwitchBan.n16.test.ts`,
    `src/features/auth/__tests__/accountIsolation.test.ts`, harness DW-9 seeds 191/266 and the
    rearranged DW-F-3/seed-565 test (editor empty at handover, A's base holds the text),
    `src/features/writing/hooks/__tests__/draftSessionStaleLoad.dw7.test.tsx`,
    `e2e/accountSwitch.spec.ts`.
  - **Holds by: `structural`.** The decisive check lives in the row and in the one writer: a
    row that names another owner is refused by the mutator regardless of which writer sent it
    and when. The editor side is handover bookkeeping — the mirror is stamped by an effect and
    the empty handover is one synchronous block inside one function — and its failure mode now
    fails safe: a row that names no owner is refused ('no-owner'), not misattributed.

- **I4 — guest text becomes an account note at sign-in instead of disappearing.**
  - Holds in: `src/features/auth/services/migrateDocuments.ts:30-44` (newest of the two guest
    addresses, `GUEST_DRAFT_TTL_MS` check at `:43`), `:66-74` with the explicit guard
    `!existingUserDraft` (`:68-69`); guest writers — both guest addresses are written by
    the mutator since DW4-2 (`GuestDraftService.saveGuestDraftToStorage` → `applyWrite`).
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
  - Holds in: `owner` is a field of the row itself (DW4-4): `buildLocalDraft` stamps the mirror
    (`draftPersistence.ts:36`, the `?? user.uid` fallback covers the genuinely unowned new/guest
    text), the unload copy stamps it directly (`useDraftCore.ts:264,293`), and `applyWrite`
    refuses a row with no owner at all ('no-owner', `draftWriter.ts:341`) before reading
    anything else. The editor-side helpers stay in `draftOwnerGuard.ts:23-66`, the stamping
    effect at `useDraftAutosave.ts:73-102`; the rescue carries the snapshot with the owner it
    was taken under (`rememberRescuePayload` `draftWriter.ts:229-234`).
  - Proven by: the mutation removing the owner read reddens the no-owner case
    (`expected 'written' to be 'no-owner'`; output in `justwriting-docs/report-2026-11-03-dw4-4.md`);
    harness DW-9 seeds 191/266, `useDraftAutosave.test.ts`, `draftSessionStaleLoad.dw7.test.tsx`.
  - **Holds by: `structural`.** A write cannot enter any address without naming an owner in the
    row. The DW-9 stamp moved from «after the debounce» to «when the text changes» in the
    previous step; now it backs a schema field instead of carrying the rule alone.

### 6.1 Timing protections this page currently relies on

Per the acceptance rule at the top, these are named as assumptions, not as evidence. Step 4 of
the DW-4 plan (dw4-4) removed two of the three listed here on 01.11:

- Removed — «the leaving account finishes writing before the reload» as a protection for
  I3/DW-F-3: the row names its owner, so a copy that lands late is attributed to its owner or
  refused, never misattributed. What remains is the LOSS window already documented in I1
  (F-3 #4: text typed after `FLUSH_LIMIT_MS = 1500`, `src/core/auth/accountReload.ts:15,61-67`,
  is not persisted at all) — it was never a misattribution risk and stays an accepted I1 gap.
- Removed — the unmount-save writer firing on account change: it reacted to the uid change,
  wrote the same text again and bumped the epoch before the rescue, whose write was then
  refused as stale — the editor stayed filled, the new owner typed over the old text and the
  mixed buffer went to the new owner's row (harness seed 183). The writer is now unmount-only
  (`useDraftAutosave.ts:321-338`), and the handover belongs to the rescue alone.
- Removed by step 5 — DW-10-F-1: the rescue used to name the epoch that was live at the moment
  of writing (`getDraftGeneration(prev)`), so an account switch inside an unclosed note save
  wrote the just-saved text back as the previous owner's draft. The snapshot now remembers the epoch
  its text was typed under, when this hook instance took it for that owner (after a remount it is
  unknown: epoch maps are per account). If a close came after it (`isDraftClosed`,
  `src/features/writing/services/draftWriter.ts:163`) the snapshot is dropped and nothing is
  written — that text lives in the note. Otherwise the write names the owner's current epoch: a
  session end is no reason to refuse the text, and a close arriving mid-write is refused by the
  mutator. Harness
  `DW-10-F-1` is an ordinary green test since this step.
- Narrowed by step 5 (DW5-2) — the rescue snapshot window: when the previous owner's write
  failed while the new owner had already typed, the snapshot (`rescuePayloads`) waited in memory
  for a trigger that could not come — the rescue only ever ran on an account change.
  `retryRescuePayloads` (`useDraftAutosave.ts:214`) re-delivers it on the next autosave attempt
  and on `visibilitychange` (`useDraftAutosave.ts:228`, `:257`), and it never touches the editor.
  The rescue itself repeats only while the screen still holds that snapshot or its continuation
  (`useDraftAutosave.ts:128-133` — DW5-3.1): a return of the text to the screen is not an edit,
  and a foreign buffer must not be cleared by somebody else's rescue. What remains: a tab that dies before a retry lands loses the previous owner's text,
  because with the vault not explicitly switched off there is no plaintext copy to fall back on
  (SEC-56), and a persistently refusing IndexedDB keeps the snapshot in memory only. Every such
  failure is reported as `DRAFT_RESCUE_FAILED`.
- Provider ban on switching accounts without a reload: `supabaseAuthProvider.ts:74-77,105` —
  `structural` since N1-6 (`providerAccountSwitchBan.n16.test.ts` reddens when the early
  return is removed).
- Guest writes name `{uid, epoch}` to the mutator since dw4-2 (reviewer note 03.11 13:55,
  seed 103); DW-F-2 stays in the map as the history of the finding.
