# Design audit fixes (tickets for Antigravity)

Self-contained file. Prefix — `DESIGN-`. Source: design audit run with impeccable, taste-skill, emil-design-eng and ui-ux-pro-max skills against the live app (desktop viewport, 1280x900 unless noted).

**Scope note: mobile-specific issues are explicitly OUT of scope for this batch** (mobile is a separate, already-tracked workstream). Do not touch `Mobile*.tsx` components (`MobileHomeScreen`, `MobileWriteScreen`, `MobileMeScreen`, `MobileLogScreen`, `MobileFocusScreen`, `MobileNoteActionsSheet`, `MobileArchiveSidebarSheet`, `MobileWriteToolbar`, etc.) as part of these tickets, even where a similar pattern exists there. If a fix naturally touches a shared non-mobile file that a mobile component also imports, that's fine — just don't go fix the mobile component itself.

## Context
- Theme system: `src/index.css` — 5 themes (`theme-amethyst`, `theme-modern`, `theme-notion`, `theme-spotify`, `theme-stripe`), all built on CSS custom properties (`--bg-base`, `--text-main`, `--text-muted`, `--surface-card`, `--surface-elevated`, `--accent-*`, `--brand-*`). `theme-notion` is the only **light** theme — treat it as the canary for any hardcoded-color bug.
- Animation library: `motion` (the renamed Framer Motion), imported as `motion/react` throughout `src/features/**` and `src/shared/components/**`.
- Run `npm run typecheck && npm run lint && npm run test:ci` before considering any ticket done (repo's own `ci` script).

---

## DESIGN-1 — AI page layout breaks on narrow desktop windows (577-750px) 🔴

**Diagnosis (verified):** On `/ai`, at viewport widths between roughly 577px and 750px (a non-maximized browser window or split-screen layout — NOT a phone), the message-composer `<textarea>` placeholder wraps into a single vertical column, one character per line ("Нап/иши/те/гру/ппа..."), because the flex row containing the textarea, the "+" attach button, and the "Отправить" send button doesn't give the textarea a `min-width: 0` / `flex-1` escape hatch — the neighboring fixed-width buttons win the flex-basis fight and squeeze the input to near-zero width. In the same width range, the persona-pill row (`Группа психологов`, `КПТ-психолог`, ...) overflows and gets visually clipped by a floating scrollbar.
Reproduces reliably at 640x750 and 700x900. Works fine at 800px+ and at real mobile widths (375px uses a different, already-correct layout — out of scope here).

**Tasks:**
1. Find the composer row component under `src/features/ai/` (search for the send-button / textarea pairing, likely in an `AIPage` subcomponent or a dedicated `Composer`/`ChatInput` component).
2. Give the textarea's flex container `min-w-0` and the textarea itself `flex-1 min-w-0` so it can actually shrink instead of being squeezed by siblings.
3. Find the persona-pill row (horizontal list of persona buttons with `Группа психологов`, `КПТ-психолог`, etc.) and make it `overflow-x-auto` with `flex-nowrap` (horizontal scroll-snap is fine) instead of letting it clip under a floating scrollbar, OR wrap it if there's vertical room.
4. Verify at 640px, 700px, 800px, and 1280px widths that: the textarea placeholder reads as normal wrapped text (not vertical single-char columns), the persona pills are either fully visible or cleanly horizontally scrollable, and nothing is clipped mid-character.

**Acceptance:** Resize the AI page window through 577px → 1280px continuously; the textarea always renders normal word-wrapped text, persona pills never get clipped by a scrollbar overlay.

---

## DESIGN-2 — Hardcoded colors bypass the theme token system (breaks light theme) 🔴

**Diagnosis (verified):** Several components use literal hex/rgba color values instead of the theme CSS variables, which means they silently assume a dark background. This is invisible on the 4 dark themes but breaks visibly on `theme-notion`, the app's only light theme.

**Worst instance — `src/shared/components/StreakDots.tsx` (around line 42):**
```
"bg-[rgba(255,255,255,0.12)] text-[rgba(232,236,233,0.85)]"   // "has session" dot
"bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.20)]"   // "no session" dot
"text-[var(--color-surface-base,#0b0d0c)]"                      // "today" dot fallback
```
White-alpha overlays on `theme-notion`'s near-white background (`--bg-base: #FAF8F5`) will render nearly invisible — the streak-day dots effectively disappear in that theme.

**Other instances:**
- `src/features/ai/pages/DiagnosticsPage.tsx` (~line 353): `const color = over ? '#f87171' : warn ? '#fbbf24' : '#7d4fd1';` — duplicates theme accent colors as literals instead of reading `var(--accent-danger)` / `var(--accent-warning)` / `var(--accent-info)`. Will visibly mismatch the rest of the UI on any theme other than amethyst (e.g. `theme-modern`'s danger is `#EF4444`, not `#f87171`).
- `src/features/profile/components/ProfileHero.tsx` (~line 81): the avatar-initials fallback gradient does `color-mix(in srgb, var(--flow-pulse-color) 60%, #000)` — mixes toward a literal black instead of a theme token (`var(--bg-base)` or similar). Low visual impact but same root cause.

**Tasks:**
1. `StreakDots.tsx`: replace the hardcoded white-alpha rgba values with theme tokens that actually vary per theme (e.g. `var(--surface-elevated)` / `var(--border-light)` / `var(--text-muted)` — pick whichever preserves the current dark-theme look while working on `theme-notion`). Remove the raw hex fallback on the surface-base var.
2. `DiagnosticsPage.tsx`: replace the three literal hex values with `var(--accent-danger)`, `var(--accent-warning)`, `var(--accent-info)` (read via inline style or a Tailwind arbitrary value referencing the CSS var, matching how the rest of the file already does theme-aware styling).
3. `ProfileHero.tsx`: replace the literal `#000` in the `color-mix()` calls with an appropriate theme token.
4. Manually switch to `theme-notion` in Settings and check the Profile page (streak dots) and Diagnostics page render correctly — text/dots must stay legible against the light background.

**Acceptance:** Switching the app to `theme-notion` shows correctly-contrasted streak dots and diagnostics status colors that match that theme's own accent palette, not the amethyst defaults.

---

## DESIGN-3 — Sidebar inactive-icon contrast fails WCAG in light theme 🟠

**Diagnosis (verified, computed WCAG contrast ratios):** `.sidebar-icon` in `src/index.css` (~line 223) sets inactive nav icons to `text-text-main/40` (40% opacity). Computed contrast against each theme's `--bg-base`:
- `theme-amethyst`: 3.41:1
- `theme-modern`: 3.60:1
- `theme-notion`: **2.55:1** — fails even the 3:1 minimum for UI components/graphical objects (WCAG 1.4.11)

**Tasks:**
1. In `src/index.css`, bump the opacity on `.sidebar-icon` (currently `text-text-main/40`) to a value that clears 3:1 on `theme-notion` specifically — since `--text-main` and `--bg-base` differ in luminance per theme, either raise the base opacity (e.g. to `/55`–`/60`) or, if per-theme tuning is preferred, add a `theme-notion .sidebar-icon` override with a higher opacity.
2. Recompute contrast after the change for all 5 themes; all must clear 3:1 minimum (ideally 4.5:1 given these are also used as the only visual cue for primary navigation).

**Acceptance:** Inactive sidebar nav icons hit ≥3:1 contrast against `--bg-base` on all 5 themes (verify `theme-notion` specifically, it's the current failure).

---

## DESIGN-4 — Framer Motion `x`/`y` shorthand isn't hardware-accelerated 🟠

**Diagnosis (verified):** 15+ components animate via `animate={{ x: ... }}` / `animate={{ y: ... }}` (Motion/Framer Motion shorthand props). These run on the main thread via `requestAnimationFrame`, not on the GPU compositor — under load (route change, data fetch, typing) these can drop frames, unlike the full `transform: "translateX()"` string form which does run on the compositor.

Confirmed desktop-relevant instances (mobile-only components excluded per scope note above):
- `src/features/navigation/components/Sidebar.tsx` (lines ~61, ~112)
- `src/features/archive/pages/ArchivePage.tsx` (line ~125)
- `src/features/archive/components/ArchiveStats.tsx` (line ~49)
- `src/features/archive/components/DocumentPreview.tsx` (lines ~193, ~480)
- `src/features/auth/pages/LoginPage.tsx` (line ~157)
- `src/features/auth/components/MigrationPrompt.tsx` (line ~109)
- `src/features/profile/components/Achievements.tsx` (line ~263)
- `src/features/profile/components/ProfileHero.tsx` (line ~125)
- `src/features/navigation/pages/ChangelogPage.tsx` (line ~57)
- `src/features/settings/components/SettingsPanel.tsx` (line ~187)

**Tasks:**
1. For each file above, replace `animate={{ x: N }}` / `animate={{ y: N }}` (and matching `initial`/`exit`) with the hardware-accelerated form, e.g. `animate={{ transform: "translateX(0px)" }}` / `translateY(...)`, keeping `opacity`/`scale` co-animated as-is if present.
2. Do a quick visual smoke test on Sidebar collapse/expand, Archive page entrance, and Login page entrance — motion should look identical, just smoother under CPU load.

**Acceptance:** No `animate`/`initial`/`exit` prop in the listed files uses the bare `x`/`y` shorthand; equivalent `transform` strings are used instead. Visual behavior unchanged.

---

## DESIGN-5 — `transition-all` used where specific properties should be named 🟠

**Diagnosis (verified):** Tailwind's `transition-all` (`transition-property: all`) is used in several places instead of naming the exact animated properties. Worst offender: `src/features/navigation/components/Sidebar.tsx` (~line 162) uses `transition-all duration-300 ease-in-out` on the sidebar's collapse/expand, which is actually animating `width` (a layout-affecting property) — imprecise and more expensive than necessary.

Other instances: `.sidebar-icon` in `src/index.css` (~line 224), `src/features/archive/components/OnThisDayCard.tsx` (~line 77), `src/features/archive/components/ArchiveSidebar.tsx` (~line 90), CTA buttons in `src/features/navigation/pages/LandingPage.tsx` (~lines 90, 126), tab buttons in `src/features/ai/pages/DiagnosticsPage.tsx` (~lines 142-178) and `src/features/ai/components/DatabaseExplorer.tsx` (~lines 220-229).

**Tasks:**
1. In `Sidebar.tsx`'s collapse/expand transition, replace `transition-all` with the actual properties in play (likely `width`, plus `opacity`/`color` for the label fade — check whether the label fade could be decoupled onto its own `transition-opacity` instead of riding the same `transition-all`).
2. For the other listed files, replace `transition-all` with the specific properties actually changing on hover/active (typically `color`, `background-color`, `border-color`, `transform` — rarely all four at once).

**Acceptance:** None of the listed files use `transition-all`; each specifies the exact CSS properties it animates.

---

## DESIGN-6 — Click targets below 44×44px on desktop toolbar/nav 🟡

**Diagnosis (verified via computed bounding boxes):** Several interactive controls measure below the 44×44px minimum recommended by WCAG 2.5.5 / Apple HIG / Material:
- Top editor toolbar icon buttons (e.g. "Новая заметка", "Открыть", "Сохранить") — 36×36px (`IconButton` component, `w-9 h-9` class)
- Sidebar nav items — 40px tall (`SidebarNavItem`, ~47×40px)

**Tasks:**
1. Find the shared `IconButton` component (used for the toolbar icons) and bump its default size from `w-9 h-9` (36px) to at least `w-11 h-11` (44px), OR keep the visual icon size the same but expand the clickable hit area with padding/pseudo-element while keeping the visual footprint compact.
2. Same treatment for `SidebarNavItem`'s vertical padding, bringing the tappable height to ≥44px.
3. Check these changes don't break the toolbar's existing spacing/alignment.

**Acceptance:** Toolbar icon buttons and sidebar nav items measure ≥44×44px in their clickable bounding box; visual density of the toolbar isn't noticeably worse.

---

## DESIGN-7 — `/features` page: identical feature-card grid 🟡

**Diagnosis (verified via screenshot):** The `/features` landing page (`src/features/navigation/pages/LandingPage.tsx` or a related features component) presents its 6 features (Режим потока, Сквозное шифрование, Серия дней, Дзен-режим, Таймер и цели, Облако) as a uniform 2×3 grid of identically-shaped bordered cards (icon glyph + heading + one-line description, repeated 6 times). This is the generic "SaaS feature grid" template pattern.

**Tasks:**
1. Break the visual uniformity: e.g. promote 1-2 of the features to a wider/taller highlighted treatment (asymmetric grid), or alternate background/border treatment between cells, or restructure as a short vertical list with larger typographic hierarchy for 2-3 "headline" features and a compact row for the rest.
2. Keep all 6 features and their existing copy — this is a layout/visual-rhythm fix, not a content rewrite.

**Acceptance:** The features section no longer reads as 6 uniform repeated cards; there's visible rhythm/variation across the section while keeping all current feature copy.

---

## DESIGN-8 — Main JS bundle size (~188KB gzip) 🟡

**Diagnosis (from a stale build in `dist/`, re-verify with a fresh `npm run build`):** The main `index-*.js` entry chunk was ~624KB raw / ~188KB gzipped — above the common ~150KB gzip soft-target for an initial SPA payload. Routes are already properly code-split via `React.lazy` (good), and the heavy `docx` dependency is already dynamically imported on-demand (good) — so this is specifically about what's eagerly bundled into the main/core chunk.

**Tasks:**
1. Run `npm run build` fresh, then open `bundle-stats.html` (already generated by the build) and identify what's inside the main `index-*` chunk.
2. Likely culprits to check: `@sentry/react`, `posthog-js`, Firebase auth/core (if eagerly imported at module scope rather than lazily), full `lucide-react` imports (verify tree-shaking is working — icons should be imported individually, e.g. `import { Settings } from 'lucide-react'`, not a barrel import that pulls the whole set).
3. If Sentry/PostHog turn out to be the bulk of it, consider lazy-initializing them after first paint (`requestIdleCallback` or a `useEffect` with a dynamic `import()`), since they're not needed for the very first render.

**Acceptance:** Report back (in this file or a follow-up note) what the main chunk's actual composition is and whether any low-risk lazy-load opportunity was found and applied. Don't force a specific number — this ticket is "investigate and fix if there's an easy win," not "hit X KB no matter what."

---

## DESIGN-9 — Settings uses raw emoji icons, rest of app uses lucide-react 🟡

**Diagnosis (verified):** `src/features/settings/components/EditorTab.tsx` (~lines 87-94) renders toggle rows via a `<ToggleRow emoji="🧘" .../>` pattern (zen mode 🧘, stream mode 🌊, focus mode 🔍, auto-hide-cursor 🖱️, typewriter ⌨️). This is internally consistent within Settings, but the rest of the app (nav, toolbar, dialogs) uses `lucide-react` SVG icons exclusively. Emoji render differently per OS/browser and can't be recolored via the theme token system the way an SVG icon can.

**Tasks:**
1. In `EditorTab.tsx` (and any other Settings component using the same `ToggleRow` `emoji` prop), replace each emoji with an equivalent `lucide-react` icon (e.g. zen mode → a suitable icon like `Flower2` or `Wind`, focus mode → `Focus` or `Search`, auto-hide-cursor → `MousePointer2`, typewriter → `Keyboard`).
2. Check whether `ToggleRow`'s prop is literally typed as `emoji: string` — if so, consider renaming/typing it to accept an icon component instead, so future toggles can't silently reintroduce emoji. Only do this rename if it's a small, contained change; if `ToggleRow` is used elsewhere with the emoji prop in ways that make a full rename risky, just swap this call site's actual glyphs and leave the prop name/type alone.

**Acceptance:** Settings toggle rows use the same lucide-react icon language as the rest of the app; no emoji rendered as functional UI icons in Settings.

---

## DESIGN-10 — Duplicate CTA copy on `/features` 🟡

**Diagnosis:** The `/features` page has two CTAs pointing at the same action (opening the editor): "Начать писать" (hero, top) and "Открыть редактор" (bottom, after the feature list). Not broken, but inconsistent labeling for the identical action.

**Tasks:**
1. Pick one label and use it for both CTAs (either is fine — "Начать писать" reads slightly more inviting for a first-time visitor, but this is a judgment call, keep whichever fits the existing copy voice better).

**Acceptance:** Both CTAs on `/features` use the same label.

---

## Priority order
1. DESIGN-1 (AI page layout break) — most user-visible functional bug
2. DESIGN-2 (hardcoded colors breaking light theme) — visible breakage in a real theme
3. DESIGN-3 (sidebar icon contrast) — accessibility
4. DESIGN-4, DESIGN-5 (motion/transition perf) — can be done together, similar mechanical fix across many files
5. DESIGN-6 (click target sizes)
6. DESIGN-7 (features card grid)
7. DESIGN-8, DESIGN-9, DESIGN-10 — polish, any order

After all tickets: run `npm run ci` (typecheck + lint + test) and do a manual pass through all 5 themes (Settings → theme picker) checking Profile, Diagnostics, and the AI page specifically, since those are where the fixes land.

---

# Round 2 — follow-up (verification found 2 tickets not actually fixed)

DESIGN-2 through DESIGN-7, DESIGN-9, DESIGN-10 verified correct (code review + live browser checks + a fresh `npm run build`). DESIGN-1 and DESIGN-8 were marked done but the underlying bug is still live. Root causes below are already diagnosed — don't re-investigate from scratch, just apply the fix.

## DESIGN-11 — AI composer textarea is still ~35px wide at 640px viewport (DESIGN-1 not actually fixed) 🔴

**What was tried:** `min-w-0` was added to the composer row and the textarea (`src/features/ai/pages/AIPage.tsx`, ~lines 591 and 634). This was necessary but not sufficient — it stopped the overflow from being invisibly clipped, but the textarea still only *has* ~35px of real space to work with, so the single-character vertical wrapping bug is unchanged in practice.

**Root cause (measured live via getBoundingClientRect at 640x750 viewport):**
- Sidebar takes 64px (`pl-16`) → 576px left for the page body.
- The page body splits into two flex children roughly 50/50: the dialogs list column gets ~289px, the chat column gets only ~287px. The dialogs list column (the one with "Новый диалог" button and "Активные/Архив" tabs) does not shrink or collapse at this width — it's taking about half the screen even though it has much less content than the chat column needs.
- Inside the 287px chat column, the composer row (`p-2.5 pl-3.5` padding, ~239px of inner content width) has to fit: the "+" attach button (32px), the textarea, and the "Отправить" send button (126px, because it renders full label + icon + padding). That leaves only ~35px for the textarea — hence the vertical single-char wrap.

**Tasks (pick at least one from each group, both together is the most robust fix):**
1. **Shrink the dialogs-list column at narrower widths.** Find the two-column layout in `AIPage.tsx` (the parent flex row containing the dialogs list and the chat panel). Give the dialogs list column a smaller `flex` basis or a `max-w-[…]` at narrower breakpoints so the chat column gets the majority of the available width — this is the page's actual content priority (the chat composer is the primary interaction, the dialogs list is secondary).
2. **Let the send button collapse to icon-only below some width.** Find the "Отправить" button in the composer row (~AIPage.tsx line 645-660 area, the button with `bg-gradient-to-b from-brand-soft to-brand-primary`). Below a container-query or viewport breakpoint (or simpler: below `md`), hide the text label and keep only the send icon, so the button doesn't cost 126px when space is tight.
3. After the fix, re-measure: at 640px viewport, the textarea's actual rendered width (via DevTools or a quick `getBoundingClientRect()` check) should be at least ~120-150px so normal word-wrapped text renders, not single-character columns.

**Acceptance:** At 640x750 and 700x900 viewports, typing in the AI composer textarea shows normal word-wrapped placeholder/text (verify by actually measuring the textarea's rendered width, not just visually glancing — the bug looks subtle until you check the actual pixel width).

## DESIGN-12 — `webVitals.ts` still statically imports `posthog-js`, undoing DESIGN-8's lazy-load 🔴

**What was tried:** `src/core/analytics/analytics.ts` was correctly converted to lazy-load `posthog-js` via a `getPosthog()` dynamic `import()`. Good change, but incomplete.

**Root cause (confirmed via fresh `npm run build` + inspecting `dist/index.html` and the compiled main chunk):** `src/core/analytics/webVitals.ts` (line 2) still has a static `import posthog from 'posthog-js';` at the top of the file, untouched by the DESIGN-8 fix. `webVitals.ts`'s `initWebVitals` is imported from `src/main.tsx` (the app's entry point) — so this static import is reachable from the eager bootstrap graph. Result: `dist/index.html` still has `<link rel="modulepreload" href="/assets/vendor-analytics-*.js">`, and the compiled main `index-*.js` chunk still contains a literal top-level `import{...}from"./vendor-analytics-*.js"` statement. The ~208KB (69.6KB gzip) posthog chunk is still loaded eagerly for every single visitor regardless of consent — the exact problem DESIGN-8 was meant to fix.

**Tasks:**
1. In `src/core/analytics/webVitals.ts`, remove the static `import posthog from 'posthog-js'` and the `typeof posthog !== 'undefined'` check.
2. Reuse the same lazy-loading mechanism `analytics.ts` already built — don't duplicate a second `getPosthog()`. The cleanest approach: export `getPosthog()` (or an equivalent) from `analytics.ts`, import *that* into `webVitals.ts`, and call `getPosthog().then(ph => ph.capture('web_vital', {...})).catch(...)` inside `sendToAnalytics`, gated the same way (`hasConsent()` check, which can stay local or also be exported/shared).
3. Rebuild (`npm run build`) and verify: `dist/index.html` no longer has a `modulepreload` link for the analytics/posthog chunk, and the main `index-*.js` chunk has no top-level static `import` referencing it (grep the built file for `vendor-analytics` — it should only appear inside dynamic `import(...)` call sites, not as a static `import{...}from"..."` declaration).

**Acceptance:** Fresh production build's main entry chunk has zero static references to the posthog/analytics vendor chunk; it only loads via dynamic import, triggered by actual consent/analytics calls.

## DESIGN-13 — Sidebar.tsx: 5 more `transition-all` instances (DESIGN-5 leftover) 🟡

**Diagnosis:** DESIGN-5 fixed the sidebar's main collapse/expand transition (~line 162, now `sidebar-transition`) and one other spot, but `src/features/navigation/components/Sidebar.tsx` still has `transition-all duration-300` at approximately lines 51, 102, 173, 230, and 264 — these are the label-fade/width transitions for nav item text, the logo wordmark, and other elements that fade in/out as the sidebar expands/collapses. Same file, same mechanism, just not covered by the original ticket's one-line citation.

**Tasks:**
1. Replace each with the specific properties actually animating (likely `opacity` and/or `width`, matching whatever the element is doing — check each one individually rather than blanket-applying the same replacement).

**Acceptance:** No `transition-all` remaining anywhere in `Sidebar.tsx`.

---

After DESIGN-11/12/13: run `npm run ci`, then `npm run build` again and re-check `dist/index.html` for the modulepreload list (DESIGN-12) and re-measure the AI composer textarea width at 640px (DESIGN-11).
