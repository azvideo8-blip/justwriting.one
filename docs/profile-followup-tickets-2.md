# Profile / AI polish — Antigravity tickets (July 2026, rev. 4, final pass)

Self-contained. Four bugs found testing v0.7.55+. Owner will NOT self-fix — implement here, owner reviews after. All root causes verified against the code.

## Guardrails (repo-specific — read before coding)

- **Run lint.** Full `npm run lint` OOMs — use `npm run lint:changed` (per file). Check both sides of every moved import (recurring miss: dead imports left after removals).
- **IDB/localStorage changes additive.** New optional fields only; bump a version/key rather than mutate existing records.
- **Surgical, match patterns. No new deps** except where a ticket explicitly calls for one (PF6-1c needs `remark-gfm`, already a common React-Markdown companion — verify it's not already installed before adding).
- On release bump the four version spots (package.json, package-lock.json, public/sw.js `CACHE_VERSION`, src/version.ts `APP_VERSION`).

---

## PF6-1 — Chat header polish: opaque popovers, find "Рассуждения", render tables (screen 1) 🟡

Three sub-issues in the reworked dialogue header (`src/features/ai/pages/AIPage.tsx`) and the markdown renderer.

**a) Popovers are see-through.** Both the settings-gear popover and the persona dropdown use `bg-surface-elevated`, which in the dark theme is **semi-transparent** (`--surface-elevated: rgba(35, 21, 66, 0.6)`, `src/index.css:91`). The message list shows through them (screen 1). Fix: give both popovers an **opaque** background — e.g. a solid surface token (`bg-surface-card` is opaque in dark? verify) or `bg-surface-elevated` + `backdrop-blur-xl` + raise to full opacity, plus the existing `shadow-xl`/border. Both the gear popover (`AIPage.tsx` ~`:625`) and the persona dropdown (~`:690`). Match whatever other solid popovers/modals in the app use so it reads as a solid card.

**b) "Рассуждения" toggle "disappeared".** It didn't — PF-2 moved it **into the settings-gear popover** (below the Кратко/Стандартно/Объёмно options, `AIPage.tsx` ~`:660`). The owner couldn't find it, largely because the popover is see-through (sub-issue a). After (a), confirm the "🧠 Рассуждения" toggle is clearly visible and works. If it still reads as hidden, surface it more (e.g. keep a small brain toggle in the header row, or a clearer label). Don't remove it from the gear silently — the owner uses this toggle.

**c) Markdown tables render as raw pipes.** The AI's "Параллели с прошлыми заметками" block is a GFM table; it shows as literal `| Тема | ... |` text (screen 1). Root cause: `src/features/ai/components/MarkdownRenderer.tsx` has **no `remark-gfm` plugin** — the sanitize schema already allows `table/thead/tbody/tr/th/td` (`:9`), but without gfm the parser never emits them. Fix: add `remark-gfm` to the markdown pipeline (`remarkPlugins={[remarkGfm]}` or equivalent for the renderer in use). Verify tables (and other gfm niceties like strikethrough, already in the schema) render, and that the sanitizer keeps the table tags. Style the table minimally (borders/padding) so it's readable in-bubble; wrap in `overflow-x-auto` so wide tables scroll instead of breaking layout.

**Acceptance:** gear + persona popovers are opaque (nothing shows through); the Рассуждения toggle is visible in the gear and works; AI markdown tables render as real tables (scrollable if wide), not raw pipes.

---

## PF6-2 — Attached-note chip regression: raw text instead of the expandable card (screen 2) 🔴

**Symptom:** attaching a note now shows raw `[#local_… · 2026-07-20] [Прикреплена заметка: "…"] <body>` in the chat instead of the collapsed paperclip card that expands the note.

**Root cause (verified):** `src/features/ai/hooks/useAIPageData.ts` builds the displayed message via `formatRefTag` (`:270-273`) as `[#${docId} · ${date}]\n[Прикреплена заметка: "${title}"]\n${content}` — the `[#… · …]` **citation marker is prepended** when the note fits inline (`fits === true`, the common case; `:282-285`). The chip detection is anchored to the string start:
- `AIChatPresentational.tsx:5` `ATTACHED_NOTE_RE = /^\[Прикреплена заметка: "([^"]+)"\]/`
- `AIPage.tsx` `const isAttachedNote = msg.role === 'user' && ATTACHED_NOTE_RE.test(msg.content)`

Because the content now starts with `[#…]`, the `^`-anchored test fails → the message renders as plain text. (Large notes that don't fit inline show only the bare marker, so their chip still works — that's why it's intermittent.)

**Fix — tolerate an optional leading citation marker everywhere the attachment markers are matched:**
1. In `AIChatPresentational.tsx`, update all three regexes to allow an optional `[#… · …]\n` prefix, e.g.:
   `/^(?:\[#[^\]]*\]\s*)?\[Прикреплена заметка: "([^"]+)"\]/` — same for `ATTACHED_NOTE_SUMMARY_RE` and `ATTACHED_FILE_RE`.
2. In `AttachedNoteCard` / `AttachedSummaryCard` / `AttachedFileCard`, the `content.replace(RE, '')` that strips the marker for the expanded body must also strip the leading `[#…]` tag (use the same tolerant regex) so the expanded note body is clean.
3. In `AIPage.tsx`, the `isAttachedNote` / `isAttachedSummary` / `isAttachedFile` tests use the same regexes — they update automatically once (1) is done; verify.
4. Regression-guard: add a small unit test that `ATTACHED_NOTE_RE` matches both `[Прикреплена заметка: "X"]…` and `[#local_abc · 2026-07-20]\n[Прикреплена заметка: "X"]…`, and that the extracted title is `X` in both.

**Acceptance:** attaching a note (short or long) shows the collapsed paperclip card with the title; expanding reveals the clean note body (no `[#…]`/marker lines); the citation tag is still present in what's sent to the model (don't strip it from the API payload — only from the display/card).

---

## PF6-3 — "Обо мне": drop subtitle + judge log, collapse by default (screen 3) 🟢

**Where:** `src/features/ai/components/ProfileFacets.tsx` + `src/features/profile/pages/ProfilePage.tsx`.

**Tasks:**
1. **Header text:** `ProfileFacets.tsx:170` — change «Темы профиля (кластеры заметок)» to just «Темы профиля» (drop the parenthetical).
2. **Judge log out of the profile:** the «Журнал судьи · … · исправлено N из M» block (`ProfileFacets.tsx:217-…`, state `judgeLog`/`judgeLogOpen` `:40-41`) renders in the profile too (screen 3). Gate it on `!readOnly` so it only shows in Diagnostics (readOnly is false there), not in the profile (readOnly true). Keep it fully working in Diagnostics.
3. **Default collapse:** on first profile open show only «Как я пишу» expanded; «Обо мне» and «История моей жизни» collapsed. In `ProfilePage.tsx`: set `defaultOpen={false}` for «Обо мне» (`:154`) and «История моей жизни» (`:162`); keep «Как я пишу» `defaultOpen={true}`. **Bump the two storage keys** (`profile_sec_about_me_v2` → `_v3`, `profile_sec_life_story_v2` → `_v3`) so users who already toggled them get the new collapsed default. Leave «Как я пишу» key as-is (or bump too — it stays open either way).

**Acceptance:** «Темы профиля» has no «(кластеры заметок)» subtitle; no judge-log block in the profile (still present in Diagnostics); opening the profile shows only «Как я пишу» expanded, the other two collapsed.

---

## PF6-4 — Life story day: full text, arrow toggle, split Facts vs Insights (screen 4) 🟡

**Where:** `src/features/ai/components/LifeStoryTimeline.tsx`, plus `AITimelineEntry` (`src/core/storage/localDb.ts`) and `AITimelineService` (`src/features/ai/services/AITimelineService.ts`).

**Owner's asks:**
1. **Show the full "Автор…" summary** — don't truncate to a first-sentence teaser. Drop `getTeaser`; render `fullText` in full, always.
2. **Arrow instead of "развернуть"/"свернуть" text** — replace the text toggle with a chevron icon (e.g. `ChevronDown` that rotates on expand), consistent with the collapse affordance elsewhere.
3. **Split Facts and Insights into two blocks.** Currently one block labelled «Факты и инсайты» lists only `facts`. Root cause: `AITimelineEntry` carries only `facts` (`localDb.ts:122`) — the summary's separate `insights: string[]` (`AIDocumentSummary`, `localDb.ts:106`) is dropped when the timeline entry is built (`AITimelineService.ts:44-50` sets `facts: summary.extractedFacts` but no insights).
   - Add `insights?: string[]` to `AITimelineEntry` (additive — same store, optional field, no migration needed).
   - In `AITimelineService` where the entry is built (`:44`), populate `insights: summary.insights ?? []`.
   - In `LifeStoryTimeline`, capture `entry.insights` into the day item alongside `facts`, and in the expanded area render **two separate blocks**: «Факты» (from `facts`) and «Инсайты» (from `insights`), each with its own heading and bullet list. Show a block only if its array is non-empty.
   - Note: existing timeline entries won't have `insights` until they're rebuilt (happens as notes get re-indexed / on the next timeline rebuild). That's fine — days without insights just don't show the Инсайты block.

**Acceptance:** each day shows the full summary text; a chevron arrow (not text) toggles the detail area; expanded shows «Факты» and «Инсайты» as two distinct lists (each hidden when empty); newly-indexed days populate insights.

---

### Summary for the owner
- **PF6-2** is the important bug: a citation-marker prefix broke the attach-note chip; fix is tolerant regexes + a guard test.
- **PF6-1a** (transparent popovers) also explains the "missing Рассуждения" — it's in the gear popover; making the popover opaque makes it visible again.
- **PF6-1c** needs `remark-gfm` for tables; **PF6-4** needs a tiny additive `insights` field on the timeline entry.
- **PF6-3** is trivial UI/text + default-collapse.
