# Console errors: draft save permission-denied + play/pause SVG warning — Antigravity tickets (July 2026)

Self-contained. Prefix: `FIX-`. Two unrelated runtime console errors found while testing. Owner reviews after.

## Guardrails
- Lint per changed file (`npm run lint` OOMs). `npx tsc --noEmit` in root (and `functions/` if rules/tests touched).
- No new deps.

---

## FIX-1 — `saveToFirestore` → "Missing or insufficient permissions" (drafts don't sync) 🔴

**Symptom (caught by the in-app error log):**
```
saveToFirestore — Missing or insufficient permissions.
{ action: "saveToFirestore", userId: "0cDtFeMakiPSQlXBAN57LOWUfZU2" }
```
The cloud draft write is rejected by Firestore rules, so the user's draft stops syncing to the cloud (local save still works).

**Where:** `src/features/writing/services/WritingDraftService.ts` → `saveToFirestore`:
```ts
const docRef = doc(db, 'drafts', draft.userId);
...
await setDoc(docRef, { ...clean, updatedAt: serverTimestamp() }, { merge: true });
```
Rule `firestore.rules` → `isValidDraft` (match `/drafts/{userId}`): `hasOnly([...allowlist...])`, `content is string && content.size() <= 100000`, per-field type checks. Read is allowed (loadDraft works), so auth/ownership is fine — it's the write validation failing.

**Primary root cause — `merge: true` + `hasOnly` gotcha:** Firestore rules evaluate `request.resource.data` as the **full merged document**, including fields already stored. If the user's existing `drafts/{uid}` doc contains any field NOT in the current `hasOnly` allowlist (e.g. a legacy `status` or any field written by an older app version before the allowlist filtering existed), every merge write now includes it → `hasOnly()` fails → permanent permission-denied. The code comment already notes transient fields like `status` are rejected — but it only filters the *outgoing* payload, not a stale field already persisted in the cloud doc.

**Primary fix (one line, self-healing):** the `clean` payload is already the *complete* draft (all allowlisted fields assembled every save), so a full overwrite is correct and safer than merge. Drop `{ merge: true }`:
```ts
await setDoc(docRef, { ...clean, updatedAt: serverTimestamp() }); // full replace: drops any stale field, satisfies hasOnly
```
This replaces the doc with exactly the allowlisted fields, so any stale field is dropped and `hasOnly` passes — it also heals already-polluted docs on the next save. Verify no other writer adds fields to `drafts/{uid}` (this service is the sole writer, so overwrite is safe).

**Secondary cause to check — content > 100 000 chars:** the rule caps `content.size() <= 100000`. This user is a heavy free-writer and E2E encryption inflates `content` (~1.3–1.4× via base64+IV), so a long encrypted draft can cross 100k and be rejected regardless of the merge fix. **After applying the merge fix, if the write still 403s, the cause is size.** Then handle oversized drafts deliberately (don't silently lose sync): e.g. raise the rule/limit to a safe bound, or persist very long drafts as a document instead of a single draft doc, or surface a clear "draft too large to sync" state. Don't just bump the limit blindly — decide with the owner. (A quick check: log/inspect `clean.content.length` when the write throws to confirm which cause it is.)

**Acceptance:** the user's draft saves to `drafts/{uid}` without permission-denied; a draft doc that previously held a stale field now writes successfully (self-heals); if size is the real cause, that's identified and handled explicitly rather than failing silently; a regression note/test covers the merge→overwrite behavior.

---

## FIX-2 — Play/pause icon: "`<path> attribute d: Expected number`" console spam 🟡

**Symptom:**
```
vendor-motion … Error: <path> attribute d: Expected number, "M6 19v4l56z".
```
Cosmetic (the play/pause button icon), but it spams the console — and now the in-app error log.

**Where:** `src/features/writing/components/BottomStats.tsx` (and the same pattern in `src/features/writing/components/Toolbar.tsx`):
```tsx
<motion.path
  initial={false}
  animate={{ d: isPlaying ? PAUSE_PATH : PLAY_PATH }}
/>
```
**Root cause:** Framer Motion animates the `d` string between `PAUSE_PATH` ("M6 19h4V5H6v14z…", two bars) and `PLAY_PATH` (a triangle). The two paths have **different command structures**, so motion's per-number interpolation emits malformed intermediate `d` values (e.g. "M6 19v4l56z") that the SVG parser rejects. `d` animation only works between paths with identical segment structure.

**Fix (ponytail — smallest that works):** don't animate `d` between incompatible paths. Swap the path instantly instead of morphing:
```tsx
<path d={isPlaying ? PAUSE_PATH : PLAY_PATH} />
```
(or, if a transition is wanted, cross-fade two separate `<path>`s via opacity — but an instant swap matches every other play/pause toggle and removes the error). Apply to both `BottomStats.tsx` and `Toolbar.tsx`.

**Acceptance:** toggling play/pause no longer logs the `<path> d: Expected number` error in either component; the icon still shows the correct play/pause shape.
