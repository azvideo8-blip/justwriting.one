# Ideas & fixes — Antigravity tickets (July 2026, rev. 2)

Self-contained. Two quick UI fixes + editor-actions swap + voice input + dialogue-list collapse + a Profile-page rework with 3 collapsible sections. Ordered: **Batch A** = small/quick, **Batch B** = feature work, **Batch C** = the big one (Profile rework + IDB migration).

Owner decisions baked in (do NOT re-litigate):
- Editor panel: **remove** `Сократить`/`Теги`/`Тональность`; **add** `Благодарность` + `Достижения`, both operating on the current note's text.
- Voice button: a **separate, visible** button next to the play/stop control (not hidden in a menu).
- Dialogue list: add a **collapse/expand** toggle.
- Personas: **remove `Редактор`** preset for now; retarget the facet deep-link to `cbt`.
- "Story of my life" moves into the **Profile page** as one of **3 collapsible sections**; themes/portrait appear **automatically, no manual buttons** — but **Diagnostics stays exactly as it is** (all its buttons kept). The button-hiding is Profile-only, via a prop.
- Portrait auto-gen threshold = **≥20 analyzed notes** (aligns with themes' `BOOTSTRAP_MIN`).

## Verified baseline — reuse, do NOT rebuild

Checked against the code:
- **Reengagement card** — `src/features/ai/pages/AIPage.tsx`: JSX `:417-442`, loader effect `:175-189` (`AITimelineService.getMostRecent(1)`), gate `showBanner` `:287-303`, handlers `:305`/`:311`. Rendered inside the sidebar above `dialogues.map`.
- **Temporal-scope chip** — `AIPage.tsx:529-540`; set in `useAIChat.ts:281-292` from `parseTemporalQuery`; consumed in `useAIChatContext.ts:350-351`. ✕ clears via `handleClearTemporalScope`.
- **Editor quick actions** — `AI_ACTIONS` array `src/features/writing/components/AIPanel.tsx:13-21` (7 actions: shorten/accents/ideas/summarize/tags/mood/continue). Server prompts + `actionSchema` `functions/src/ai/editWithAI.ts:7,20-28`. Client union `AIAction` `src/features/ai/services/AIService.ts:11`. Apply-back in `AIPanel.handleApply` `:87-106`. `AIPanel` reads live text from `useContentStore`, gates on offline + `useAiLimitStore.remaining`.
- **Play/stop control** — desktop: `Toolbar.tsx` (animated PLAY↔PAUSE path, `onPlay`/`onPause`, `status === 'writing'`); mobile: `MobileWriteToolbar.tsx` (same, `t('play')`/`t('pause')`). This is the anchor for the voice button.
- **AIPage sidebar** — desktop block `AIPage.tsx:386-441` (`!isMobile`), width from `sidebarWidth`. The dialogue list is here.
- **Preset personas** — `PRESET_PERSONAS` `src/features/ai/services/AIPersonaService.ts:5-10` (`group_psychology`, `cbt`, `editor`, `coach`). Rendered in the switcher `AIPage.tsx:587-628` (uses `allPersonas`).
- **Profile page (current)** — `src/features/profile/pages/ProfilePage.tsx`: renders `ProfileHero`, then `KPIStrip`, `Heatmap`, `HourRhythm`, `MoodTrend`, `StreakRibbon`, `Achievements` (`:95-125`), plus an achievements-reset footer (`:126-143`).
- **AI-profile blocks (in Diagnostics)** — `DiagnosticsPage.tsx:594-636`: `<ProfileFacets/>`, `<ContactDoors/>`, `<MassAnalyzeNotes/>`, and the "Психологический портрет" card (`:607-636`, manual `handleGeneratePortrait`). Components live in `src/features/ai/components/`.
- **Themes ALREADY auto-build, gated at 20** — `useEmbeddingIndexer.ts` calls `AIProfileFacetService.incrementalUpdate(docId)` after indexing; `AITaxonomyService.ts:9 BOOTSTRAP_MIN = 20` + `:110 if (summaries.length < BOOTSTRAP_MIN) return 'skip'`. `ProfileFacets` manual buttons (`handleBuild`/`handleResummarize`/`handleJudge`/`handleExport`) are optional, not the only path.
- **Per-day data for the life story** — `aiTimeline` store: `AITimelineEntry { documentId, date (YYYY-MM-DD from doc's lastSessionAt), month, summary, themes, tone, valence, arousal }` (`localDb.ts:118-128`, store `:267-271`, indexes `by-month`/`by-date`). `AITimelineService` builds/queries these; `summarizeDocument` callable generates summaries.
- **IDB** — `openDB('justwriting-local', 13, { upgrade(db, oldVersion, …) })` `localDb.ts:333`; migrations guarded `if (oldVersion < N)`; bump to 14 for new store/field.
- **Routing** — pages in `src/app/AppRoutes.tsx:7-53`; `/profile` → `ProfilePage` (`:43`).

## Guardrails for every ticket (repo-specific — read before coding)

- **Run lint.** Full `npm run lint` OOMs — use `npm run lint:changed` (per changed file). Prior work left dead/misplaced imports after moves; check both sides.
- **No fire-and-forget AI bursts** from a hot path (keystroke, render, mount effect). Every new AI call fires only on an explicit user gesture **or** a debounced+single-flight+cooldown-gated trigger, always behind `useAiLimitStore.remaining` + the server cap. This is the exact class of the past digest-storm bug — treat portrait auto-gen (C-2) with extra care.
- **IDB changes additive**: optional fields / new stores only, one version bump (13→14), migration guarded. Never rewrite existing records in a migration.
- **Surgical edits, match patterns.** Reuse `AI_ACTIONS`/`ACTION_PROMPTS` shape, the existing panel-toggle precedent, the existing `incrementalUpdate` auto-path. No new abstractions/deps.
- On release bump the **four** version spots (CLAUDE.md checklist: `package.json`, `package-lock.json`, `public/sw.js` `CACHE_VERSION`, `src/version.ts` `APP_VERSION`).

---

# Batch A — quick fixes

## FIX-1 — Remove the "Хочешь поговорить о том, что писал N дней назад?" card 🟢

**Context:** `AIPage.tsx` — JSX `:417-442`, loader `:175-189`, gate `:287-303`, handlers `:305`/`:311`.

**Tasks:**
1. Comment out the JSX card `:417-442`.
2. Comment out the loader `useEffect` `:175-189` + the `suggestedNote` state (so `getMostRecent` stops firing on mount).
3. Comment out `showBanner`, `handleOpenSuggestedDialogue`, `handleDismissSuggestedNote`; drop the `AITimelineEntry` import if now unused (grep; leave `X`/`ArrowRight` if used elsewhere).

**Acceptance:** card gone from the dialogue list; no `getMostRecent` call on `/ai` mount; `lint:changed` clean, no orphan imports.

---

## FIX-2 — Explain the temporal-scope chip ("Только июль 2026") 🟢

**Context:** `AIPage.tsx:529-540`. Keep the chip (it's a live retrieval filter); make it self-explanatory.

**Tasks:**
1. Add a `title`/tooltip: `«ИИ ищет только в заметках за этот период. Нажми ✕, чтобы искать по всем.»`.
2. Add a small leading icon (`Clock`/`Filter`, size 11-12) before the label.
3. Leave the ✕-clears behavior untouched.

**Acceptance:** hover explains what the chip does and how to clear it; retrieval behavior unchanged.

---

## ED-1 — Swap editor actions: −Сократить/Теги/Тональность, +Благодарность/Достижения 🟢

**Context:** `AI_ACTIONS` `AIPanel.tsx:13-21`; `ACTION_PROMPTS`+`actionSchema` `editWithAI.ts:7,20-28`; `AIAction` union `AIService.ts:11`; apply-back `AIPanel.handleApply:87-106`. Actions run on the current note (`content` from `useContentStore`).

**Remove:** `shorten`, `tags`, `mood`. **Add:** `gratitude`, `achievements`. Result = 6 actions: accents, ideas, summarize, continue, gratitude, achievements.

**Tasks:**
1. `editWithAI.ts`:
   - `actionSchema` `:7`: remove `'shorten'`,`'tags'`,`'mood'`; add `'gratitude'`,`'achievements'`.
   - `ACTION_PROMPTS` `:20-28`: delete the three; add:
     - `gratitude`: `«На основе этой записи составь список, начинающийся со слов "Я благодарен себе за…", и перечисли 3–5 пунктов, за что автор может быть благодарен себе. Обращайся на "ты"/от первого лица как в примере. Только список, без вступления.»`
     - `achievements`: `«На основе этой записи составь список, начинающийся со слов "Сегодня я сделал…", и перечисли, что автору удалось сделать — даже небольшое. 3–5 пунктов. Только список, без вступления.»`
   - (Keep the phrasing so output literally opens with "Я благодарен себе за…" / "Сегодня я сделал…".)
2. `AIService.ts:11`: update `AIAction` union to match.
3. `AIPanel.tsx:13-21`: remove the three entries; add two with icons `Heart` (gratitude) + `Trophy` (achievements), `labelKey` `ai_action_gratitude` / `ai_action_achievements`.
4. Add RU+EN keys `ai_action_gratitude` («Благодарность») / `ai_action_achievements` («Достижения») where `ai_action_shorten` lives (grep). **Remove** the now-unused `ai_action_shorten`/`ai_action_tags`/`ai_action_mood` keys.
5. Apply-back: gratitude/achievements fall into the default labeled-append branch (`:97-104`) — fine, verify. `tags`/`mood` special-cases are gone; ensure the `activeAction === 'tags'` branch (`:91`) and the `t('ai_apply_tags')` button label (`:273`) still make sense with `tags` removed (drop the tags-specific apply path if `tags` no longer exists).
6. `editWithAI.test.ts`: update the action-enum test to the new set.

**Acceptance:** panel shows 6 buttons; gratitude output opens with "Я благодарен себе за…", achievements with "Сегодня я сделал…"; applies below the note; removed actions gone from UI/schema/union/prompts/tests/i18n; `editWithAI.test.ts` green; `lint:changed` clean.

---

## UI-1 — Collapse/expand the dialogue list + remove the "Редактор" persona 🟢

**Context:** sidebar `AIPage.tsx:386-441`; persona switcher `:587-628` (from `allPersonas`); `PRESET_PERSONAS` `AIPersonaService.ts:5-10`.

**Tasks:**
1. **Collapse toggle:** add a button (chevron `PanelLeftClose`/`PanelLeftOpen` from `lucide-react`) in the sidebar header (near "Новый диалог") that toggles a local `sidebarCollapsed` state. Collapsed = hide the dialogue list + tabs, shrink the sidebar to a thin strip showing only the expand button (and optionally the "+" new-dialogue icon). Persist the flag in `localStorage` so it survives reloads. Desktop only (mobile sidebar already behaves differently — leave it).
2. **Remove `Редактор`:** delete the `{ id: 'editor', … }` entry from `PRESET_PERSONAS` `:8`. Grep for hardcoded `'editor'` references — notably `ProfileFacets.tsx` navigates `` `/ai?persona=editor&draftFacet=${f.id}` `` (`:267`): **retarget it to `cbt`** (`/ai?persona=cbt&draftFacet=…`). Confirm no other code assumes `editor` exists (`AIPersonaService`, persona seeding, tests).

**Acceptance:** a toggle collapses/expands the dialogue list and the state persists; no `Редактор` in the persona switcher; the facet deep-link points at `cbt`; nothing references a missing `editor` persona; `lint:changed` clean.

---

## VOICE-1 — Voice input as a visible button next to play/stop 🟡

**Context:** play/stop control in `Toolbar.tsx` (desktop) + `MobileWriteToolbar.tsx` (mobile). No existing voice code.

**Approach — native, zero deps:** Web Speech API (`window.SpeechRecognition || window.webkitSpeechRecognition`), `lang` from current app language (ru-RU / en-US). Feature-detect; hide where unsupported (Firefox, older Safari/iOS).

**Tasks:**
1. Hook `useSpeechInput({ lang, onResult })` in `src/shared/hooks/` — wraps `SpeechRecognition`, `interimResults` on, exposes `{ supported, listening, start, stop }`, appends final transcript via `onResult`; `onerror`/`onend` handled quietly (never throws).
2. Add a **separate mic button right beside the play/stop button** in `Toolbar.tsx` and `MobileWriteToolbar.tsx` — same size/visual weight as play/stop so it's clearly visible (icon `Mic`; while listening show `MicOff`/red pulse). Render only when `supported`.
3. On result, insert transcript into the editor at the caret via `useContentStore` (append if caret position isn't tracked). Stop on second click / blur / session stop.
4. i18n keys for label + errors (`voice_start`/`voice_stop`/`voice_error`).

**Non-goals:** no server transcription, no audio storage, no background listening.

**Acceptance:** in Chrome a visible mic button sits next to play/stop on desktop and mobile and dictates into the editor in the app's language; unsupported browsers show no mic button; denied permission shows a quiet message and doesn't break writing.

---

# Batch C — the big one

## PROFILE-1 — Rework the Profile page into 3 collapsible sections 🔴

**Context:** `ProfilePage.tsx` (current blocks), the AI-profile components (`ProfileFacets`, `ContactDoors`, portrait card in `DiagnosticsPage.tsx:594-636`), `aiTimeline`/`AITimelineService`, IDB `localDb.ts:333`.

**Goal:** `/profile` becomes three **collapsible, nicely-styled** sections:
1. **«Как я пишу»** — everything Profile shows today.
2. **«Обо мне»** — the AI author profile (themes, contact doors, psych portrait), **auto-populated, no manual buttons**.
3. **«История моей жизни»** — the per-day life log (former STORY-1).

Split into sub-PRs C-1..C-4.

### C-1 — Collapsible section shell + "Как я пишу"
1. A reusable `CollapsibleSection` (title, expand/collapse chevron, remembers open/closed in `localStorage`). One small component; no lib. Match the app's card styling (`bg-surface-card`, `border-border-subtle`, rounded).
2. Wrap the **current** Profile content (`KPIStrip`/`Heatmap`/`HourRhythm`/`MoodTrend`/`StreakRibbon`/`Achievements`, `ProfilePage.tsx:95-125`) into section 1 «Как я пишу». Keep `ProfileHero` above the sections. Keep the achievements-reset footer inside this section (or at page bottom).

**Acceptance:** Profile renders 3 sections (2 and 3 can be stubs at this step); section 1 = today's content, unchanged in behavior; open/closed state persists.

### C-2 — "Обо мне" section (auto, no buttons)
Reuse `ProfileFacets`, `ContactDoors`, and the portrait card — **stripped of all manual action buttons in the Profile page only**. **Diagnostics (`DiagnosticsPage.tsx:594-636`) stays exactly as it is** — all its buttons kept. Do this with a `readOnly` prop that defaults to `false`; Diagnostics renders the components with no prop (unchanged), Profile passes `readOnly`.
1. Add a `readOnly` prop (default `false`) to `ProfileFacets` that, when `true`, hides `handleBuild`/`handleResummarize`/`handleJudge`/`handleExport` buttons (`:155-201`) and the DEV `FacetDiagnostics`. Themes still render; they already build automatically via `useEmbeddingIndexer → AIProfileFacetService.incrementalUpdate`, gated at `BOOTSTRAP_MIN = 20`. **Add a visible empty-state** when `<20` analyzed notes: «Темы появятся автоматически после ~20 проанализированных заметок» (state the rule to the user).
2. Reuse `ContactDoors` as-is (read-only display) inside the section.
3. **Portrait, auto-generated (⚠ fire-and-forget risk — the digest-storm class):** in the Profile section only, display the portrait with **no "Сгенерировать/Обновить" buttons** (Diagnostics keeps its manual buttons). Replace with an auto-trigger:
   - Generate once when analyzed-notes first reaches **≥20** (aligns with themes' `BOOTSTRAP_MIN`), and regenerate when a meaningful number of new notes have been analyzed since `generatedAt` (e.g. +N).
   - Trigger from the **indexer-completion path** (same place `incrementalUpdate` runs), **not** on Profile render. Must be **single-flight** (a global in-progress guard), **debounced**, **cooldown-gated**, behind `useAiLimitStore` + server cap. Store `portraitText` + `generatedAt` + `notesAtGeneration` in IDB.
   - This is the one sub-task to review hardest for bursts/races before shipping.
4. Keep an "Экспорт .md" only if the owner wants it — default per instruction is **no buttons**, so omit.

**Acceptance:** «Обо мне» shows themes (auto, with a clear <20 empty-state), contact doors, and a portrait that appears/refreshes automatically with **no** Build/Refresh/Judge/Generate buttons; portrait generation is single-flight + gated (prove no burst on rapid note indexing); `lint:changed` clean.

### C-3 — "История моей жизни" data + generation (former STORY-1)
**Date problem (owner's point):** a note written *today* usually narrates *yesterday*. `AITimelineEntry.date` = writing date. The life-story needs an explicit **event date**, default `writingDate − 1 day`, user-editable.
1. **IDB migration 13→14**, guarded `if (oldVersion < 14)`: new store `lifeStory` `{ eventDate /*YYYY-MM-DD, keyPath*/, text, sourceDocumentIds[], generatedAt, edited }`, index `by-eventDate`. Do not touch `aiTimeline`.
2. `LifeStoryService` (read/write; default-event-date = writingDate−1; never overwrite an `edited` entry). Compose the 1–2 sentence line from existing `AITimelineEntry.summary`/`themes` first; only call a summarize callable when there's no usable summary, and only via gesture/gated trigger.
3. One unit check on the `writingDate − 1` defaulting.

**Acceptance:** `lifeStory` store created via additive guarded migration (bump DB→14); service returns per-day entries with event-date defaulting to writing-date−1; edited entries preserved.

### C-4 — "История моей жизни" UI (section 3)
1. Vertical timeline inside collapsible section 3: one row per `eventDate` → the one-line text, edit-in-place, a date control to fix the day.
2. Generation stays gesture-driven (a per-day "сгенерировать/обновить" affordance is OK here since it's explicit — unlike «Обо мне»), one gated AI call each. Empty-state for days with no entry.

**Acceptance:** section lists days with a one-line summary; event date defaults to writing-date−1 and is editable; generation only on explicit gesture within the AI limit; nicely styled to match the other two sections.

### C-5 — (future) "Написать об этой теме" — close the ring 🔵
Not for this pass — do after PROFILE-1 lands. Adds the missing return edge **profile → editor**, so the ring (write → notes → AI → profile → write) fully closes instead of almost.
1. On each theme card in «Обо мне» (`ProfileFacets`) add a small **«Написать об этой теме»** action → navigates to the editor (`/`) pre-seeded with a prompt from the theme's label/summary (e.g. a title/first line «Про <тема>: …», or a soft nudge inserted into an empty draft). Reuse the existing new-session/editor entry; no new store.
2. Optional twin on «История моей жизни» rows: «дописать про этот день» → editor seeded with that day's context.

**Acceptance (when built):** from a theme card the user lands in the editor with a topic already seeded, ready to write — the profile stops being a dead-end and feeds back into writing.

**Release note for the whole PROFILE-1:** additive migration only; bump DB→14 and the four release version spots; run `lint:changed`; extra burst/race review on C-2 portrait auto-gen. C-5 is future/optional — not blocking.
