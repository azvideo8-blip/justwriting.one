# AG-MIND-A2-interface — thin candidate registration + inject W1/W4 into chat

**Priority:** P1 · MIND Stage-1 keystone (lights up W1 + W4) · Scope: Medium
**Files:** `src/features/ai/hooks/useAIChatContext.ts` (turn-1 context block, ~812–962), `src/shared/ai/buildChatPrompt.ts` (`buildChatSystemPrompt`), `src/shared/ai/prompts.ts` (`NOTES_GUARD`), producers `AIThemeLedgerService` (W1), `AILexiconService` (W4).

**Why:** W1 (theme ledger: first-seen dates + verbatim quotes) and W4 (voice map) are built but **not wired into chat** — Stage-1 value is invisible until this lands. A2 is the thin "trigger": gather candidates from producers, cap them, inject compact snippets. This is the **thin interface only** — the full competitive ranker (two bands, `sim×salience×diversity`, injection journal) is W2/Stage 2. Do NOT build the ranker here.

**Cost invariant:** 0 new LLM/embedding calls on the chat hot path. Producers read already-stored local artifacts.

## Tasks

1. **Thin candidate collector `assembleMemoryContext` (Stage-1 form).**
   - Define a small candidate shape: `{ text: string; category: 'voice' | 'first_seen' | 'quote'; source?: string }`.
   - Collect from producers:
     - **W4 voice:** `AILexiconService.getVoiceMap()` → one compact snippet (~200 chars) "Пользователь часто использует свои слова: …" (null → skip, per B3).
     - **W1 first-seen / quote:** for themes relevant to the current turn (e.g. themes of the attached/recent note, or top-salience active themes), surface a first-seen line ("эту мысль ты впервые записал <дата>") and/or a verbatim evidence quote. Keep tiny: ≤2–3 lines total.
   - **Per-category caps/floors** (hard limits, no ranking yet): voice ≤~200 chars, first-seen/quote ≤~3 lines. If nothing qualifies, inject nothing.
   - Leave a stub hook / comment for the future W2 injection journal (audit + shadow) — do not implement it.

2. **Wire injection** — pick the existing path, don't invent a new one:
   - Add a compact optional section in `buildChatSystemPrompt` (like the `documentContent`/`userPortrait` sections) fed by the collected candidates, OR extend the turn-1 `proactiveBlock` in `useAIChatContext.ts`. Prefer whichever keeps it a **candidate injection, not a hardcoded per-producer append** (so W2 can later replace the collector without touching call sites).
   - Candidates go through `sanitizeAiInput` before injection (same as other context).

3. **W1 read-path prompt line** in `NOTES_GUARD` (or adjacent): "когда узнаёшь мысль пользователя — если известно, назови, когда она впервые появилась, с датой; предпочитай дословную цитату его словами." Keep consistent with the existing no-fabrication rules (only state a date/quote that actually came from the ledger, never invented — ties to W8 guard).

## Acceptance
- [ ] Voice map (when B3 passes) appears as a compact system-prompt snippet; sparse user (voice=null) → nothing injected.
- [ ] For a note whose theme exists in the ledger, the chat context carries a first-seen date line and/or a verbatim quote (capped ≤3 lines).
- [ ] Injection goes through the collector (candidate model), not per-producer hardcoded appends — call sites don't reference W1/W4 internals directly.
- [ ] 0 new LLM/embedding calls added to the chat send path (verify no `AIService.embed`/`generate` in the collector).
- [ ] `tsc` 0; **full vitest suite** green; lint on changed files.
- [ ] Manual/visible check: with seeded ledger + lexicon, a chat reply can reference a first-seen date and use the user's own vocabulary.

## Out of scope
Full W2 assembler (two-band competitive ranking, `sim×salience×diversity`, floors-vs-caps arbitration, injection journal, portrait/turn-1 migration to candidates) → Stage 2. Reconcile (W1 Stage 3). Self-model half of W4 (Stage 2).

**After delivery — my review:** confirm no hot-path network calls, candidate-model wiring (not hardcoded appends), caps enforced, and that injected dates/quotes are only ever from the ledger (no fabrication path). This is the first user-visible MIND surface — I'll sanity-check a real chat turn.

**Note for the customer:** this is the ticket that makes Stage-1 visible — after it, chat can say "ты впервые записал это в июле 2026" and speak in the user's words. W1/W4 alone showed nothing in the UI.
