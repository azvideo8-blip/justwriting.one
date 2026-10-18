READ ~/Projects/agent-scripts/AGENTS.MD BEFORE ANYTHING (skip if missing).

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Code Review

Rules for `/code-review`, `/security-review`, and any reviewer agent. (`REVIEW.md` is only read by the hosted GitHub service, which this repo doesn't use — keep review rules here.)

**Important means:** user text lost or silently rolled back; plaintext of notes/mood/tags reaching logs, the AI provider without opt-in, or the cloud unencrypted; RLS/auth/admin gate bypass; a migration or crypto/format change that locks existing data out; a change to `deploy.yml`/`ci.yml` that lets a red check deploy. Style, naming, refactors, and missing-test suggestions are Nit at most.

**Known bug classes to hunt for first (each has bitten this repo):**
- A failed read treated as "nothing there" — "no" vs "no answer" must stay distinct; same on writes.
- A fix in one of two entry points while prod goes through the other — grep callers before accepting a fix.
- A new test that was never red — ask what mutation would make it fail.
- A mock whose insertion order hides a real `order by` dependency.
- Background/infra AI calls spending the user's chat quota; new error codes without consumers.
- Client code reading a `VITE_` var that the build doesn't set.
- A gate tightened without checking the real account state (it once removed the owner's admin tab).

**Evidence:** every finding cites `file:line` from the source, not an inference from a name. A "missing handling" claim names the caller path that reaches it. A "pre-existing" bug is marked as such, not blamed on the diff.

**Do not report:** what CI already enforces (lint, typecheck, i18n audit, ratchets, bundle budget, gitleaks); `dist/`, `coverage/`, `playwright-report/`, `test-results/`, `*.lock`, `.postulates-results-*.json`; in `scripts/` only near-certain and severe.

**Cap:** at most five Nits. **Summary:** starts with the count; says plainly when there is nothing to fix.

## 6. Release Checklist
- **Review before the bump:** `/code-review` and `/security-review` over the diff since the previous release commit (`git diff <prev-release>..HEAD`). Every finding is either fixed or recorded as «ложное, потому что …» in the release note/memory.
- **Mobile e2e locally before the release push** (owner, 2026-10-18 — standing approval to start Docker for this): `docker ps` first (don't touch foreign or someone else's `jw-stand-*`), `scripts/stand/up.sh` on the alt ports, `scripts/ci/mobile-e2e.sh`, then `scripts/stand/down.sh`. CI is the second check, not the first: one runner, 30 min a round.
- **CI runs on every branch push** (not only `main`); a new push cancels the branch's old run. Push the working branch, get it green, then put the release on `main`. Deploy still counts only the `main` push run.
- **A change that alters the look updates its e2e ratchet in the same commit:** `rg` the changed class/text/testid in `e2e/` before committing. Agent reports (Qoder etc.) must include the mobile e2e result, or the batch is not accepted.
- **Version bump — FOUR places, all must match:**
  1. `package.json` `"version"`.
  2. `package-lock.json` — run `npm install --package-lock-only` after bumping `package.json`.
  3. `public/sw.js` `CACHE_VERSION = 'vX.Y.Z'` — triggers cache eviction of old assets in users' browsers.
  4. `src/version.ts` `APP_VERSION` — **this is the version the UI displays** (Sidebar, Settings, Diagnostics, export payloads). A release that skips this ships new code while the site still shows the old number.
  - Before pushing, grep for stragglers: `rg "X\.Y\.<old>" --hidden -g '!node_modules' -g '!.git'` (changelog *history* entries are the expected exception).

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
