# Follow-up bugfixes: citations, taxonomy 400, silence placeholder — Antigravity tickets (July 2026)

Self-contained. Prefix: `FIX-`. Three unrelated bugs found in testing. Owner reviews after.

## Guardrails
- Lint per changed file (`npm run lint` OOMs). Run `npx tsc --noEmit` in root AND `functions/` before declaring done (past batches shipped a red root tsc).
- No new deps.

---

## FIX-1 — Citation refs without `#` render as raw text 🔴

**Symptom:** in an AI answer, some note references are clickable date-chips and open the note (good), while others show as raw `[local_a91845f8-…]` ("кракозябры").

**Root cause (verified):** the citation pipeline only recognizes the `[#id]` form.
- `AIPage.tsx:211` `citeRegex = /\[#([a-zA-Z0-9_-]+)\]/g` (builds `citationMeta`).
- `AIPage.tsx:268` `processCitations` replaces only `/\[#([a-zA-Z0-9_-]+)\]/g` → a `#cite-<id>` link.
The model is **inconsistent**: it emits `[#local_…]` sometimes and a bare `[local_…]` (no `#`) other times. The bare form isn't matched, so it stays literal. The id in the bare form is a real `documentId`.

**Fix (client-side robustness — the durable fix; don't rely on the prompt alone):**
1. Broaden citation detection to also catch a **bare doc-id ref**: `[local_<uuid>]` (and, to be safe, `[#? <id>]` where the id matches a known cited/attached documentId). Keep it **specific** — match `local_`-prefixed ids (and/or ids already present in `citationMeta` / attached docs), NOT arbitrary `[text]`, so normal bracketed prose isn't turned into links.
   - Update BOTH `citeRegex` (meta extraction, `:211`) and the `processCitations` replace (`:268`) to handle the optional-`#` form: e.g. `/\[#?(local_[a-zA-Z0-9-]+)\]/g` in addition to the existing `[#id]`.
2. `handleCitationClick(id)` already resolves by id — ensure a bare ref resolves the same way (look the doc up by `documentId` regardless of whether meta was pre-populated; fall back to a title/date lookup if `citationMeta[id]` is missing).
3. **Also nudge the prompt** (secondary): in the chat system prompt / citation instruction, state explicitly that every note reference MUST be `[#id]` with the `#`. Cheap reinforcement, but keep the client fix as the real guard.

**Acceptance:** both `[#local_…]` and `[local_…]` render as the same clickable date-chip that opens the note; normal bracketed text in answers is not turned into links; clicking either form opens the correct note preview.

---

## FIX-2 — `deriveTaxonomy` returns 400 (repeated) 🟠

**Symptom:** console spam — `deriveTaxonomy … 400 (Bad Request)` several times.

**Root cause (verified):** `buildSummaryDigest` (`AITaxonomyService.ts:100-114`) joins up to 200 note blocks (themes/insights/people) with **no length cap**. The server schema is `digest: z.string().min(20).max(60_000)` (`functions/src/ai/deriveTaxonomy.ts`). With enough notes the digest exceeds 60 000 chars → `safeParse` fails → **400**. And because the taxonomy auto-heal (English→Russian re-derive we added) runs after indexing, it retries and 400s **every time** (the storm), never storing a taxonomy → stays stale → re-triggers.

**Fix:**
1. **Cap the digest client-side** in `buildSummaryDigest` — stop appending blocks once the joined length approaches a safe limit (e.g. **≤ 50 000 chars**, leaving headroom under the 60k server max). Prefer most-recent or most-informative summaries when truncating (the summaries are already ordered — cap by accumulated length, drop the rest).
2. **Stop the retry storm:** in the auto-re-derive path (`deriveAndStore` / `ensureBootstrap`), if `deriveTaxonomy` fails, do NOT immediately retry on the next index — back off (e.g. a cooldown timestamp in localStorage, or only re-attempt on an explicit gesture) so a persistent failure can't hammer the endpoint. The single-flight lock already exists; add a failure cooldown.
3. Optional: server returns 400 with a generic "Bad Request" — a clearer error body would help debugging, but the client cap is the actual fix.

**Acceptance:** with a large note corpus, `deriveTaxonomy` receives a ≤50k digest and succeeds (no 400); a persistent taxonomy failure backs off instead of retrying on every index; the console 400 spam is gone; the auto English→Russian re-derive still works when the payload is valid.

---

## FIX-3 — Silence mode: the placeholder jumps to center 🟡

**Symptom:** turning on «Режим тишины (бета)», the empty-editor prompt («Что я хотел бы изменить?») shifts to the middle of the screen instead of starting at the top-left like normal.

**Root cause (verified):** `WritingEditor.tsx` — the container gets `silenceMode && "max-w-[68ch] mx-auto w-full"` (DGN-6 reading measure). `mx-auto` centers the 68ch column, so with the editor empty the left-aligned placeholder now sits mid-pane and "jumps" when the mode toggles.

**Fix:** keep the writing surface's start position stable when toggling silence mode. Reading-measure width is fine, but it shouldn't make the empty state feel centered/jumpy:
- Prefer a consistent left/edge alignment for the column (e.g. `max-w-[68ch]` without `mx-auto`, or center the column but ensure the text/placeholder start is where the user expects), so entering silence mode narrows the measure without visibly shifting the caret/placeholder to screen-center.
- Confirm the transition doesn't fight `editorWidth` (DesktopWritingLayout already sizes the editor) — avoid double-centering.
- Verify with the settings panel both open and closed (the panel narrows the pane and exaggerates the centering).

**Acceptance:** toggling «Режим тишины» narrows the reading column but the placeholder/caret start position stays consistent (no jump to screen-center); looks right with the settings panel open and closed; normal (non-silence) layout unchanged.
