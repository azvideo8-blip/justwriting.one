# Engineering Tickets — justwriting audit (v0.7.8)

> Generated from the full audit (tech-debt / architecture / system-design / code-review / testing-strategy / documentation).
> **Status: all tickets implemented in v0.7.8.** Kept as the audit trail and rationale.
> Each ticket is self-contained: **Context → Files → Exact changes → Verify**.
>
> Global verify after each ticket:
> ```bash
> npm run typecheck && npm run lint && npm run test:ci
> # functions changes:
> cd functions && npm run build && npm test
> ```

---

## Status overview

| Ticket | Type | Status |
|--------|------|--------|
| TICKET-001 — Fix lint errors (`no-explicit-any`) | Infra/bug | ✅ Done |
| TICKET-002 — Stop tracking `bundle-stats.html` | Infra | ✅ Done |
| TICKET-003 — Align `/api/chat` input schema with callable | Bug | ✅ Done |
| TICKET-004 — Sanitize input in `/api/chat` | Security | ✅ Done |
| TICKET-005 — De-duplicate AI persona prompts | Arch | ✅ Done |
| TICKET-006 — Aggregate counter instead of `collectionGroup` scan | Perf/cost | ✅ Done |
| TICKET-007 — Log swallowed Gemini error | Maintainability | ✅ Done |
| TICKET-008 — Cap `aiPortrait` size in Firestore rules | Security | ✅ Done |
| TICKET-009 — Fix App Check documentation drift | Doc/security | ✅ Done |
| TICKET-010 — Backend tests (limits / injection / schema parity) | Test | ✅ Done |
| TICKET-011 — Split oversized components | Code | ✅ Done |
| TICKET-012 — API docs for AI endpoints | Doc | ✅ Done |
| CI wiring — run functions build+test in CI | Infra | ✅ Done |

---

## TICKET-001 — Fix lint errors (`no-explicit-any`) blocking CI
**Context:** `npm run lint` runs with `--max-warnings 0` and failed with 3 `no-explicit-any` errors, so `main` did not pass its own CI gate.
**Files:** `api/chat.ts`, `src/features/ai/pages/DiagnosticsPage.tsx`
**Changes:**
- `api/chat.ts`: import `type ServiceAccount` from `firebase-admin/app`; `let credentialConfig: ServiceAccount | undefined;`.
- `DiagnosticsPage.tsx`: both `catch (e: any)` → `catch (e: unknown)` with `const errMsg = e instanceof Error ? e.message : 'Ошибка сервера';`.
**Verify:** `npm run lint` → 0 problems.

## TICKET-002 — Stop tracking `bundle-stats.html`
**Context:** ~1.5 MB build artifact committed despite being in `.gitignore`.
**Change:** `git rm --cached bundle-stats.html` (kept the `.gitignore` entry).
**Verify:** `git ls-files bundle-stats.html` → empty.

## TICKET-003 — Align `/api/chat` input schema with the callable
**Context:** The Vercel endpoint and the Firebase callable validated the same payload with different Zod schemas (drifted: `documentContent` 10k vs 50k; no 200K total refine on the Vercel side).
**Files:** `api/chat.ts`
**Change:** Mirror the callable schema — `personaId` enum, `documentContent` `max(50_000)`, `.refine` total messages ≤ 200,000 chars.
**Verify:** `npm run typecheck`; schema-parity test (TICKET-010).

## TICKET-004 — Sanitize input in `/api/chat`
**Context:** The callable runs messages + document through `sanitizeAiInput` (neutralizes `<|system|>`/`<|user|>`/`<|assistant|>`); the streaming path did not.
**Files:** `api/chat.ts`
**Change:** Added local `sanitizeAiInput`; applied to each message and to document content in `buildSystemPrompt`. (Output sanitization not added — streaming output is rendered through the frontend `react-markdown` + `rehype-sanitize` pipeline.)
**Verify:** `npm run typecheck`.

## TICKET-005 — De-duplicate AI persona prompts (single source of truth)
**Context:** Persona prompts + `TOPIC_GUARD` lived in three places; the `api/chat.ts` inline copy had drifted. `functions/` is a separate deploy unit and can't import root `src/`.
**Files:** `api/chat.ts`, `functions/src/shared/prompts.ts` (parity), `src/shared/ai/prompts.ts` (canonical)
**Change:** `api/chat.ts` imports `{ PERSONA_PROMPTS, TOPIC_GUARD } from '../src/shared/ai/prompts'` (~140 inline lines removed). `src/shared/ai/prompts.ts` is pure (no imports) so it bundles cleanly into the Vercel function. Added `src/core/__tests__/promptsParity.test.ts` asserting the `functions/` copy stays byte-identical with the canonical file.
**Verify:** `npm run typecheck && npm run test:ci`.

## TICKET-006 — Aggregate counter instead of `collectionGroup` scan
**Context:** `withinGlobalDailyLimit()` scanned `collectionGroup('daily')` on every request (O(DAU) reads) and was non-atomic with the per-user increment.
**Files:** `functions/src/shared/aiUtils.ts`, `api/chat.ts`, `firestore.rules`
**Change:** `withinGlobalDailyLimit` now reads a single `aiGlobalDaily/{date}` doc; `recordUsage` increments both `aiUsage/{uid}/daily/{date}` and `aiGlobalDaily/{date}` in one batch (both backends). Added rule `match /aiGlobalDaily/{date} { allow read, write: if false; }`.
**Migration note:** the aggregate starts empty on deploy day, so pre-deploy usage isn't carried over (one-time soft-cap reset). At higher RPS, shard the counter (`aiGlobalDaily/{date}/shards/{0..9}`).
**Verify:** `npm run typecheck`; `cd functions && npm run build`.

## TICKET-007 — Log the swallowed Gemini error in `chatWithAI`
**Files:** `functions/src/ai/chatWithAI.ts`
**Change:** `catch` → `catch (e) { console.error('[chatWithAI] Gemini request failed:', e); ... }`.
**Verify:** `cd functions && npm run build`.

## TICKET-008 — Cap `aiPortrait` size in Firestore rules
**Files:** `firestore.rules`
**Change:** in `isValidUserCreate` and `isValidUserUpdate`, `aiPortrait is string` → `aiPortrait is string && aiPortrait.size() <= 100000`.
**Verify:** Firestore rules tests / emulator.

## TICKET-009 — Fix App Check documentation drift
**Context:** `ARCHITECTURE.md` listed every function as "Firebase Auth + App Check" but all 8 functions set `enforceAppCheck: false`.
**Files:** `ARCHITECTURE.md`, `SECURITY.md`
**Change:** Auth column → "Firebase Auth"; added an explicit note that App Check enforcement is **off** and protection relies on Firebase Auth + rate limits. Enforcement itself was intentionally **not** enabled (would break prod without the frontend App Check provider in all envs) — left as a separate hardening follow-up.
**Verify:** `grep -rn "App Check" ARCHITECTURE.md SECURITY.md`.

## TICKET-010 — Backend tests: limits / injection / schema parity
**Files (new):** `functions/vitest.config.ts`, `functions/src/shared/__tests__/aiUtils.test.ts`, `functions/src/shared/__tests__/schemaParity.test.ts`; `functions/package.json` (+vitest, `test` script).
**Change:** 15 tests covering `INJECTION_PATTERNS` (ru/en), `sanitizeAiInput` (marker neutralization + 50k truncation), and schema parity.
**Verify:** `cd functions && npm test`.

## TICKET-011 — Split oversized components
**Files:** `src/features/ai/pages/AIPage.tsx`, `src/features/ai/pages/DiagnosticsPage.tsx`, `src/features/settings/components/SyncDiagnostics.tsx`
**Change:** Extracted data/logic into hooks (`useAIPageData`, `useDiagnosticsData`, `useSyncDiagnostics`) and presentational components (`AIChatPresentational`, `DatabaseExplorer`, `SummaryModal`). Sizes: AIPage 715→394, DiagnosticsPage 1071→485, SyncDiagnostics 808→359. No behavior change; all tests green.
**Verify:** `npm run typecheck && npm run lint && npm run test:ci`.

## TICKET-012 — API documentation for AI endpoints
**Files (new):** `docs/api/ai-endpoints.md` (linked from `ARCHITECTURE.md` and `README.md`).
**Change:** Request/response schemas and error codes for `POST /api/chat` and the callable functions, plus the rate-limit model.

## CI wiring — run functions build+test in CI
**Files:** `.github/workflows/ci.yml`
**Change:** Added a build-job step `cd functions && npm ci && npm run build && npm test` so the new functions tests run on every PR (previously functions were only built in the post-merge deploy job).

---

## Remaining follow-ups (not blockers)
- **Enable App Check enforcement** (`enforceAppCheck: true` + `/api/chat` token check) only after confirming the frontend initializes the App Check provider in all environments; verify on a preview deploy.
- **Shard `aiGlobalDaily/{date}`** if AI traffic grows past ~1 write/sec sustained.
- **DiagnosticsPage (485) / AIPage (394)** are still slightly above the ~350 soft target — fine for now.
