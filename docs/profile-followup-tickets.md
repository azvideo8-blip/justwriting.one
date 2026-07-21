# Profile / AI follow-up — Antigravity tickets (July 2026, rev. 3)

Self-contained. Five issues found in testing the v0.7.55 profile/AI work. Owner will NOT self-fix — implement here, owner reviews after. All investigated against the code; root causes below are verified.

## Guardrails (repo-specific — read before coding)

- **Run lint.** Full `npm run lint` OOMs — use `npm run lint:changed` (per file). Check both sides of every moved import.
- **No fire-and-forget AI bursts** from a hot path (render/mount/keystroke). Any new AI trigger fires only on a user gesture OR a single-flight + cooldown + threshold gate behind `useAiLimitStore.remaining` + the server cap. This is the digest-storm class — the portrait auto-gen (`AIProfileService.autoGeneratePortrait`) is the reference pattern: lock claimed synchronously before any await.
- **IDB/localStorage changes additive.** Bump a version/key rather than mutate existing records.
- **Surgical edits, match patterns.** No new deps.
- On release bump the four version spots (package.json, package-lock.json, public/sw.js `CACHE_VERSION`, src/version.ts `APP_VERSION`).

---

## PF-1 — Voice dictation blocked by managed-browser policy (screen 1) 🟢 mostly-explain

**Screenshot:** «Запись видео и аудио запрещена — Ваша организация запретила использовать камеру, микрофон… обратитесь к системному администратору».

**Root cause — NOT our bug.** The voice feature uses the Web Speech API (`webkitSpeechRecognition`), which needs microphone access. That dialog is a **managed-Chrome / OS enterprise policy** (`AudioCaptureAllowed=false` or a managed device) blocking the mic for the whole page. Our code can't grant it. The owner needs an unmanaged browser/profile, or an admin policy change (check `chrome://policy`).

**The only code task (small, optional):** make the failure legible instead of a bare toast. In `useSpeechInput` (`src/shared/hooks/useSpeechInput.ts`), the `onerror` handler already toasts `voice_error + error`. Add specific messaging for `error === 'not-allowed'` / `'service-not-allowed'`: show a clear line like «Микрофон заблокирован браузером или политикой организации» instead of the raw error code. No behavior change otherwise.

**Acceptance:** when the mic is policy-blocked, the user sees a human-readable explanation (not `service-not-allowed`); everything else unchanged.

---

## PF-2 — AI dialogue header still cluttered (screen 2) 🟡

**Screenshot:** below «СОБЕСЕДНИК / Группа психологов» there are still two dense rows: «ОБЪЁМ: Кратко / Стандартно / Объёмно / 🧠 Рассуждения» and the persona chips row. The earlier declutter (UI-1) only removed the `Редактор` persona and added a sidebar collapse — the **header itself was never minimized**. This is what the owner means by "не сделалось минималистично".

**Where:** `src/features/ai/pages/AIPage.tsx`:
- «ОБЪЁМ» row (Кратко/Стандартно/Объёмно + 🧠 Рассуждения): `:553-585` (`responseLength` + `reasoning`, handlers `handleSetResponseLength` / `handleSetReasoning`).
- Persona switcher row: `:587-628` (from `allPersonas`, `handleNewPersona` / `openPersonaDetail` / create).

**Tasks (pure layout — no logic/state changes):**
1. Collapse the «ОБЪЁМ» controls (all four: Кратко/Стандартно/Объёмно/Рассуждения) into a single **gear/settings `IconButton`** placed in the top action cluster (`AIPage.tsx:542-549`). Clicking it opens a small popover/menu holding those four controls. Reuse an existing popover/menu pattern in the repo (grep for one — e.g. how other menus are done; **do not add a library**). Preserve all handlers.
2. Streamline the persona row: keep it, but reduce visual weight — e.g. show only the active persona prominently with a compact «сменить ▾» that expands the rest, OR keep chips but make the row less tall / secondary. Confirm the exact interaction is fine to decide in-PR; the goal is a calmer header. Keep create-persona + info (ⓘ) reachable.
3. No change to `responseLength`/`reasoning`/persona state or persistence.

**Acceptance:** the dialogue header shows the interlocutor + a gear (объём/рассуждения live in its popover and still work) and a slimmer persona control; nothing about response-length/reasoning/persona behavior changes; mobile not regressed.

---

## PF-3 — Profile sections don't fill the width (screen 3) 🟢

**Screenshot:** the three sections sit in a narrow centered column with large empty margins on a wide screen.

**Where:** `src/features/profile/pages/ProfilePage.tsx:107` — container is `max-w-6xl mx-auto px-4 md:px-9`. `max-w-6xl` (~72rem) is the cap.

**Task:** make the sections span (near) full width. Remove the `max-w-6xl` cap (or raise to `max-w-screen-2xl` / none) while keeping comfortable side padding (`px-4 md:px-9` or a bit more on very wide screens). Keep `ProfileHero` and the sections aligned to the same width. Don't let content run edge-to-edge with no padding.

**Acceptance:** on a wide desktop the three sections use the available width (no large empty side gutters), with sensible padding; still looks right on narrow/mobile.

---

## PF-4 — Theme names stay English + don't auto-rebuild (screen 4) 🔴

**Screenshots:** themes are still English («Work and time boundaries», «Finance and income stability», «Product development and AI», «Rejection and trust resilience», «Internal critic and self-assess», «Childhood trauma and desire patterns»). They now show «активна» (the 14→30d window fix worked). People facets appeared on their own; theme labels did not refresh.

**Root cause (verified):**
- Theme domain labels come from the **stored taxonomy**. In `AIProfileFacetBuilder.ts:230`, `const label = spec.fixedLabel ? spec.label : (fb.label || spec.label || 'Тема')` — for domain (fixed-label) facets the label is the taxonomy domain label verbatim.
- The taxonomy is derived **once** (bootstrap at ≥20 notes) and stored. `AITaxonomyService` **never re-derives** while a taxonomy exists: `:55 if (this.getStored()) return 'skip'`.
- The stored domains have English labels (produced before `deriveTaxonomy`'s Russian rule existed, or the model returned English anyway). `incrementalUpdate` re-clusters new notes into those same English domains but does not re-label them.
- **People** (`aiPeopleIndex`, builder `~:290 label: pn.name`) update incrementally, so they appear automatically — hence the asymmetry the owner noticed.
- The only path that re-derives the taxonomy is a full «Построить/Перестроить темы» (`handleBuild`) — which we removed from the profile (readOnly). So labels are stuck English forever.

Answer to "должен пройти какой-то период?": no — clustering/`lastAt` update over time, but domain **labels never change** without a taxonomy re-derive.

**Tasks:**
1. **Auto-heal English taxonomy (one-time re-derive).** In `AITaxonomyService` add a cheap staleness check: if any stored domain `label` has **zero Cyrillic characters** (`/[а-яё]/i`), treat the stored taxonomy as stale — clear it (or flag) so the next bootstrap re-derives in Russian. Wire this so it triggers a **single** re-derive via the existing gated path (same place taxonomy bootstraps), NOT on every render. Must be single-flight + behind the AI limit/cost cap (mirror the portrait auto-gen gating). After re-derive, existing facets should pick up the new Russian domain labels — verify the rebuild/relabel actually propagates to stored facets (a taxonomy re-derive alone may need a facet rebuild to re-attach labels; ensure labels visibly update).
2. **Harden `deriveTaxonomy` (functions/src/ai/deriveTaxonomy.ts).** The prompt already says «СТРОГО на русском». Add a server-side guard: after parsing domains, if a `label` has no Cyrillic, reject/repair (e.g. drop that domain or re-request once) so future derivations don't reintroduce English. Keep it cheap — don't loop indefinitely.
3. Do **not** put a manual rebuild button back in the profile (owner wants it automatic). The gated auto-re-derive is the mechanism.

**⚠ risk:** step 1 triggers AI work (taxonomy derive + facet relabel/rebuild = multiple `summarizeFacet`/`deriveTaxonomy` calls). Treat it exactly like the portrait auto-gen: synchronous single-flight lock, cooldown, threshold, limit-gated. Review for bursts on mass indexing before shipping.

**Acceptance:** a user whose stored taxonomy is English gets Russian theme labels after one gated auto-re-derive (no manual button); future derivations reject English; no AI burst on rapid indexing (prove single-flight); people/themes both stay current.

---

## PF-5 — Life story: surface insights/facts behind "развернуть", drop the edit button (screens 5, 6) 🟡

**Screenshots:** each day shows the third-person «Автор описывает…» summary as the whole text, plus a pencil (edit) button.

**Owner's intent:** don't lead with the «Автор…» narrative as the only content. Show a short teaser, and an **«развернуть»** button that expands to the fuller summary **with insights and facts**. Remove the edit (pencil) button.

**Where:** `src/features/ai/components/LifeStoryTimeline.tsx`. Currently `loadData` captures only `timelineSummary` (`entry.summary`) per day; the render shows `entry?.text || item.timelineSummary`. The pencil/edit control is the `handleStartEdit` button (`~:202-210`).

**Data available:** the `aiTimeline` entry (`AITimelineEntry`, `localDb.ts:118-128`) also has `facts: string[]` (extractedFacts) and `themes: string[]`, alongside `summary`. Pull `facts` (and optionally `themes`) into the day item next to `timelineSummary`.

**Tasks:**
1. In `loadData`, capture `entry.facts` (and `entry.themes` if useful) per day into `DayItem` alongside `timelineSummary`.
2. Render each day **collapsed by default**: a short teaser line (first sentence of the summary, or a trimmed version), plus a **«развернуть»** toggle. Expanded state shows the full summary **and** a facts/insights list (`facts` as bullets). Match the existing collapse pattern used elsewhere (e.g. `ProfileFacets` per-card expand, or `CollapsibleSection`).
3. **Remove the edit (pencil) button** and its flow (`handleStartEdit` / the inline edit textarea / `handleSaveEdit` / edit state) — the owner doesn't want manual editing here. If removing `handleSaveEdit` orphans `LifeStoryService.save`/`delete` usage from this component, that's fine (the service methods stay; other callers/tests may use them — grep before deleting service methods). Keep `LifeStoryService` intact.
4. Days with only a summary and no facts: just show the summary (no empty facts block). Days with nothing: keep the «Нет описания для этого дня» line (no button).

**Note on "Автор…" phrasing:** that third-person voice is the existing `summarizeDocument` output reused across the app — leave the summary text itself as-is; this ticket only changes *presentation* (teaser + expand + facts), per the owner's own suggestion ("можно сделать автор… и кнопку развернуть").

**Acceptance:** each day shows a short teaser + «развернуть»; expanding reveals the full summary plus a facts/insights list; no pencil/edit button anywhere in the timeline; `LifeStoryService` unchanged; `lint:changed` clean.

---

### Summary for the owner (what's code vs environment)
- **PF-1** is a browser/organization policy block — not fixable in code beyond a clearer error message. Voice needs an unmanaged browser or an admin policy change.
- **PF-2 / PF-3 / PF-5** are straightforward UI work.
- **PF-4** is the substantive one: the taxonomy never auto-re-derives, so English labels are stuck; needs a gated one-time re-derive + a server-side Russian guard. Highest risk (AI cost/bursts) — review like the portrait auto-gen.
