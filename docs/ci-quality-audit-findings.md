# CI / quality audit — verified findings (2026-08-01)

External read-only audit of CI, testing and operations. **Not fixed — recorded on request.**
Every claim below was checked against the code; the ones the audit got wrong, or that
are not defects at all, are marked as such at the end.

---

## 1. P0 — CI runs its most important gates against `main`, not against the pull request

**Verified.** `.github/workflows/ci.yml`, "Bundle size comparison":

```bash
git checkout origin/main -- .   # replaces the WORKING TREE *and the index*
npm ci && npm run build         # builds the base
git checkout -- .               # restores from the index — which now holds the base
```

`git checkout <ref> -- .` writes the ref's content into the index as well, so the
`git checkout -- .` meant to undo it restores the base a second time. From that line on
the workspace is `main`.

Everything after it therefore tests the base branch:

- bundle size budget (reads the base's `dist`)
- Playwright E2E (`npm run build` rebuilds the base)
- Functions build & test
- **rules and emulator tests**

A pull request can break Firestore rules, Cloud Functions or E2E and still go green.
The earlier gates — prod audit, typecheck, lint, unit tests, build — do run on the PR.

**Fix:** build the base in a separate worktree or a second checkout path; never mutate the
candidate workspace. Add a step after the comparison asserting `git rev-parse HEAD` still
equals the candidate SHA and `git diff --quiet` passes — a two-line tripwire for the whole
class.

## 2. P1 — Coverage thresholds are configured but never run

**Verified.** `vite.config.ts` sets 75/70/75/75, but `package.json` has only
`"test:ci": "vitest run"` — no `--coverage` anywhere, and CI calls that script. The
thresholds cannot fail anything.

**Fix:** a `test:coverage` script running `vitest run --coverage`, called by CI.

## 3. P1 — Cloud Functions have no lint gate at all

**Verified.** Root ESLint ignores `functions/**` (`eslint.config.js`), `functions/package.json`
has no `lint` script, and CI runs only `npm ci && npm run build && npm test` there. The
repository's own rules — no floating promises, dependency boundaries — never touch backend code.

## 4. P1 — Warnings are invisible in production

**Verified.** `src/shared/errors/logger.ts`: the console output is `import.meta.env.DEV`-only,
and only `level === 'error'` reaches `reportError`. A `logger.warn` in production goes
nowhere. Draft deletion and cloud-sync failures in `sessionActions.ts` use exactly that.

Consequence for the planned migration: there is no way to measure save-failure rate or
sync backlog from the field.

## 5. P2 — `scripts/prod-audit.mjs` fails open

**Verified.** `JSON.parse(raw || '{}')` — when `npm audit` fails for any reason other than
"advisories found" (registry outage, auth, malformed output, CLI regression) there is no
stdout, the report becomes `{}`, no vulnerabilities are found and the script prints
"✔ No blocking advisories" and exits 0. A false green.

**Fix:** distinguish "audit completed, advisories present" (exit code 1 *with* parseable
JSON) from "the command failed" (anything else) and fail on the latter. Also audit
`functions/` — its production dependencies are never gated.

## 6. P2 — Two tests assert nothing

**Verified.** `src/core/services/__tests__/SyncService.integration.test.ts`:

- `'expired queue items are cleaned up during sync'` inserts an item, asserts it exists,
  and never syncs. It cannot observe cleanup.
- `'syncPending skips when already in progress'` has no assertion at all.

The audit also flags `src/features/auth/__tests__/migration.test.ts` for re-implementing
`migrateDocuments` inside the test instead of importing the production path — worth
confirming before trusting anything that suite reports about guest→account migration.

## 7. P1 — E2E is presence-smoke, not critical path

**Verified in outline.** The writing spec types into a textarea and never saves or reloads;
the "save" test asserts button visibility; archive search only checks the input accepts
text; the AI spec covers the unauthenticated denial page; the one auth test is skipped in
CI. Five Playwright projects are configured, CI runs Chromium only.

The journeys that actually carry risk — save → reload → archive, draft recovery, offline
queue and reconnect, guest→account migration, vault lock/unlock, export, streaming AI and
its fallback — are not covered.

---

## Findings that are about work not yet started

The audit's other P0 — "no executable VPS/Supabase cutover or rollback plan" — is accurate
as an observation but is not a defect in shipped code: that migration has not begun. It
belongs to the migration plan, not to this list. Same for most of the runbook staleness:
the AI-outage runbook still names Gemini (routing is OpenRouter now) and the rollback guide
suggests `gcloud firestore export` for a *restore*, which is wrong and worth fixing before
it is ever needed under pressure.

One item there is a real trap worth keeping in mind regardless of migration: **rolling the
frontend back after an IndexedDB version bump.** Clients that already opened schema 19
cannot open it with older JS, which fails with `VersionError`. Any rollback plan needs a
compatible-version window, not just "promote the previous build".

## Audit quality note

Unlike the two security audits reviewed earlier the same day, every checkable claim here
held up against the code, including exact file and line references. Its two "critical
dependency" cousins did not — those cited advisory ranges without reading the lockfile.
Weight this source accordingly.
