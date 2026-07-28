# AG-DRAFT-1 — the draft indicator must stop saying "Saved" when only the local copy saved

**Priority:** P1 · hid a total cloud-sync outage for ~6 hours today · Scope: Small-Medium
**Files:** `src/features/writing/hooks/useDraftAutosave.ts`, `src/features/writing/hooks/useDraftCore.ts`, `src/features/writing/services/WritingDraftService.ts`, the component rendering `saveStatus`.

## Why

On 2026-07-27 every cloud draft save failed with permission-denied for hours (`5461f761` — an encrypted-field shape the Firestore rule rejected). The console filled with errors. **The UI said "Saved" the entire time.**

That is not an accident of that one bug — it is the designed behaviour:

```ts
// useDraftAutosave.ts:53
const result = await persistDraft(draft, { remote: true });
if (!result.localOk && !result.remoteOk) {
  throw new Error('Both local and remote save failed');
}
```

`persistDraft` computes `remoteOk` correctly and `draftPersistence.test.ts:84` asserts it. The caller then **discards it** unless the local save failed too. No throw → `wrapSave` calls `markSaved()` → the indicator reads "Saved". Same in `doForceSave` (`:67`).

The only trace is `logger.warn(..., 'will retry on next change')` plus whatever `reportError` prints. A user who is not watching devtools has no signal at all, and the retry it promises is just the unconditional 30 s interval — it never escalates, never backs off, and never reports that it has been failing for an hour.

Local drafts were safe throughout, and that matters: this is not a data-loss bug. It is a **trust** bug. The indicator's only job is to answer "is my writing safe?", and today it answered yes while one of the two copies had not been written since the session began.

## Three separate silent paths

**1. Remote-only failure renders as success.** Described above. `useDraftAutosave.ts:53` and `:67`.

**2. `saveToFirestore` reports success without writing anything.**

```ts
// WritingDraftService.ts:133
if (!draft.userId) return;
if (!isProfileLoaded(draft.userId)) return;
```

Both return `undefined`, which `Promise.allSettled` records as `fulfilled`, so `remoteOk` is `true` and the cloud copy is stale. The abort return at `:144` is legitimate (a newer save superseded this one) and must stay success — the other two are not.

**3. Permanent and transient failures are indistinguishable.** Being offline and being rejected by a security rule produce the same 30 s retry forever. Offline resolves itself and should stay quiet; a rule rejection never will and should be said out loud.

## Task

**A. Propagate `remoteOk` into the status.** Extend the save status so "saved locally, cloud copy stale" is its own state — do not reuse `'error'`. The local write succeeded and the user's text is safe; the message must not read as data loss.

**B. Don't nag on the first failure.** A single miss is usually a dropped connection. Surface the state after **3 consecutive** remote failures (≈90 s on the interval), and clear it immediately on the first success.

**C. Escalate permanent failures at once.** On Firestore codes `permission-denied`, `unauthenticated`, `invalid-argument`, `failed-precondition`: surface immediately and stop the 30 s remote retry for the session (keep local autosave running). These cannot be fixed by repetition — today's bug spent six hours proving it. Everything else keeps the existing retry.

**D. Close the two false-success returns.** `saveToFirestore` must distinguish "did not write" from "wrote". Simplest form: return a boolean, and have `persistDraft` treat "did not write" as `remoteOk: false`. Keep the abort path as success.

## Acceptance criteria

- A user whose cloud saves are all rejected sees, within ~90 s, that the cloud copy is not current — and never sees "Saved" while it isn't.
- Being offline for one interval changes nothing on screen.
- A permission-denied stops the retry loop and says so; local autosave keeps working.
- With everything healthy, the indicator behaves exactly as it does today.

## Tests

Do not test `persistDraft` again — it already behaves correctly and is covered. **The gap is the hook**, so the tests belong at `useDraftAutosave` / `useDraftCore`:

1. Remote rejects, local succeeds → status is **not** `'saved'` after the 3rd consecutive failure.
2. Two failures then a success → status returns to `'saved'`, counter resets.
3. `permission-denied` on the first attempt → surfaced immediately, no further remote attempts fire.
4. `isProfileLoaded === false` → `remoteOk` is false (this one does belong at the service/`persistDraft` level).

**Verify non-vacuity before reporting done:** revert each production change and confirm the matching test fails. Two bugs in a row this week were shipped under green suites that asserted a shape or a path the app never takes — a passing new test proves nothing until you have watched it fail.
