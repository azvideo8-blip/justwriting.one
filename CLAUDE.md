READ ~/Projects/agent-scripts/AGENTS.MD BEFORE ANYTHING (skip if missing).

# CLAUDE.md

Все правила работы в репо — в `AGENTS.md` (git, пуш и выпуск, проверки, приватность, поведение агента, чек-лист выпуска, защищённые пути). Он подключён целиком:

@AGENTS.md

Ниже — только то, что читают инструменты Claude: правила `/code-review`, `/security-review` и агентов-ревьюеров.

## Code Review (§5)

Rules for `/code-review`, `/security-review`, and any reviewer agent. (`REVIEW.md` is only read by the hosted GitHub service, which this repo doesn't use — keep review rules here.)

**Important means:** user text lost or silently rolled back; plaintext of notes/mood/tags reaching logs, the AI provider without opt-in, or the cloud unencrypted; RLS/auth/admin gate bypass; a migration or crypto/format change that locks existing data out; a change to `deploy.yml`/`ci.yml` that lets a red check deploy. Style, naming, refactors, and missing-test suggestions are Nit at most.

**Known bug classes to hunt for first (each has bitten this repo):**
- A failed read treated as "nothing there" — "no" vs "no answer" must stay distinct; same on writes.
- A sweep or delete keyed on "absent from a listing" — name the source of truth that the item is really gone (a tombstone, `deleted_at`); an empty or truncated listing is "no answer", not "all gone".
- A fix in one of two entry points while prod goes through the other — grep callers before accepting a fix.
- A new test that was never red — ask what mutation would make it fail.
- A mock whose insertion order hides a real `order by` dependency — when the reader sorts by key, the mock must return rows out of insertion order.
- Background/infra AI calls spending the user's chat quota; a refund that returns to a different pool than the one charged (`internal_chat` vs `bulk`); new error codes without consumers.
- Client code reading a `VITE_` var that the build doesn't set.
- A gate tightened without checking the real account state (it once removed the owner's admin tab).
- A one-shot key or mark (an offer, a queued task, a "shown" flag) taken before success: a refusal the person did not choose (signed in, failure, wrong clock, offline) must put it back (DA-3, 0.11.29).
- A loop over a snapshot (list → tens of seconds → send/write) that does not re-read its decision source (hidden from AI, trash, still exists) before each send and each write (DA-1, 0.11.29).

**Evidence:** every finding cites `file:line` from the source, not an inference from a name. A defect next to the target is not the finding until it is followed to the place that actually reads or writes the data. A "missing handling" claim names the caller path that reaches it. A "pre-existing" bug is marked as such, not blamed on the diff.

**Do not report:** what CI already enforces (lint, typecheck, i18n audit, ratchets, bundle budget, gitleaks); `dist/`, `coverage/`, `playwright-report/`, `test-results/`, `*.lock`, `.postulates-results-*.json`; in `scripts/` only near-certain and severe.

**Cap:** at most five Nits. **Summary:** starts with the count; says plainly when there is nothing to fix.

**Rounds:** a finding names its bug class, and the fix closes the class, not the one instance (grep every sibling path). If review finds the same class again on the same change, stop patching and rework the approach — on the third round the approach is wrong (0.10.10: four rounds of «forged block head» were each patched in place; the root fix — the composer passes the block list — was visible on the first). Re-reviews after round two read only the new diff and don't repeat findings already raised.
