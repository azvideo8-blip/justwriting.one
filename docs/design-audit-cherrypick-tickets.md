# Design audit — cherry-pick + directions (Antigravity tickets, July 2026)

Self-contained. Prefix: `DGN-`. Source: the design audit (`justwriting-one (1).md`). Owner decisions baked in — **do not re-litigate**:
- **Font stays Inter** (NOT Lora). TYP-1 and every "switch to Lora" recommendation are **out of scope**.
- **Gamification stays default-ON** (streaks/achievements/WPM metric/milestones untouched). Silence is **opt-in** behind a new beta toggle (Batch B), not the default.
- **MOB-1 (layout mode) — DO NOT TOUCH.** The manual mode was intentionally reverted (`useLayoutMode.ts:7` comment, commit 5d3d69a); it needs proper desktop-app testing first.
- Light theme **is** getting fixed (Batch C). Russian typography **is** getting built (Batch D).

## Guardrails
- **Lint per changed file** (`npm run lint` OOMs). Check dead/misplaced imports.
- Root + functions strict TS: **run `npx tsc --noEmit` in BOTH** before declaring done (past batches shipped with a red root tsc).
- Colors go through **tokens**, not literals (this audit found 51 off-token literals — don't add more).
- Don't change the writing surface's default character except where a ticket says so; the silence bundle is gated behind Batch B's toggle.

---

# Batch A — real bugs (always-on fixes)

## DGN-1 — CSS parse error breaks a theme (CLR-1) 🔴
**Verified:** `src/index.css:184` — `--surface-popup: #171026` has **no trailing `;`**, so its value bleeds into the next line and both `--surface-popup` and `--accent-success` are broken in that theme block. (This is our own token from the popover-opacity work — the theme's popovers are currently wrong.)
**Fix:** add the `;`. Then grep the whole file for other missing semicolons / any `--bg-surface`/`--bg-elevated` the audit says are absent, and confirm every theme block defines the same token set.
**Acceptance:** every theme block parses; `--surface-popup`/`--accent-success` resolve in all themes; popovers render correctly in the affected theme.

## DGN-2 — Brand button fails WCAG AA (CLR-2) 🔴
**Verified:** `src/shared/components/Button.tsx` — `brand: 'bg-brand-primary text-bg-base …'` = dark text on #7D4FD1 (3.64:1).
**Fix:** `text-bg-base` → `text-text-main` (or white) for the `brand` variant; verify ≥4.5:1 in all themes and that it still looks right (white-on-purple is the conventional look).
**Acceptance:** brand button text ≥4.5:1 in every theme; visually unbroken.

## DGN-3 — 14px inputs cause iOS auto-zoom (MOB-2) 🟠
**Verified (audit):** `MobileWriteScreen.tsx:249`, `MobileLogScreen.tsx:145`, `AIPage.tsx:1029` use `text-sm` (14px); iOS zooms inputs <16px on focus.
**Fix:** bump those input/textarea font-sizes to ≥16px (`text-base`). Only the focusable inputs — don't restyle everything.
**Acceptance:** tapping those inputs on iOS doesn't zoom the viewport.

## DGN-4 — Kill the infinite WPM pulse during writing (MOT-1) 🟠
**Verified:** `HeaderStats.tsx:181` (`status === 'writing' && "animate-pulse"` on the WPM dot) + `BottomStats.tsx:~261`. It pulses forever in peripheral vision while writing, with no reduced-motion guard.
**Fix:** remove the `animate-pulse` on the WPM dot — keep the dot's color (`getWpmColor`) and the WPM number (gamification metric stays, just not the pulsing). Leave the sync-status pulse for Batch B.
**Acceptance:** the WPM indicator no longer pulses while writing; the number + color remain.

## DGN-5 — Autofocus the editor (UX-6) 🟠
**Verified (audit):** `WritingEditor.tsx:94-115` — the textarea isn't autofocused, so "type-to-start" has a hidden first click.
**Fix:** focus the editor textarea on mount / when a session becomes writable, so the user can type immediately. Respect: don't steal focus on mobile if it forces the keyboard up unexpectedly (guard by layout/desktop if needed).
**Acceptance:** on the writing screen the caret is in the editor and typing works with no prior click (desktop at minimum).

---

# Batch B — "Режим тишины (бета)" opt-in toggle

## DGN-6 — Silence mode as a single beta toggle (gamification stays default) 🟡
**Intent (owner):** keep the current louder/tracker experience as the default; add ONE toggle **«Режим тишины (бета)»** where the "Дзен-режим" toggle is now, which turns on a bundle of quiet behaviors. Owner will test; if it sticks, it stays.

**Where:** `WritingSettingsContext.tsx` (`zenModeEnabled` `:16-17,54`, `v2_zenModeEnabled`, `isZenActive` logic `:74-92`); toggle UI in `src/features/settings/components/EditorTab.tsx`.

**Tasks:**
1. Replace/absorb the "Дзен-режим" toggle with **«Режим тишины (бета)»** (a new `silenceMode` flag, e.g. `useLocalStorage('v1_silenceMode', false, …)` — **default OFF**). Keep the old `zenModeEnabled` working underneath or migrate it; the point is the master switch is now this one, off by default.
2. When `silenceMode` is ON, enable the bundle (all gated behind this one flag):
   - **Zen recession on first keystroke** (TYP-3): trigger `isZenActive` on the first `keydown` of a session instead of after 3s of mouse idle; restore chrome only near screen edges, not on any mouse move.
   - **HUD metrics minimal/off** (UX-7): hide the live metric HUD (or reduce to one static line) during writing.
   - **Reading measure** (TYP-2): center the editor column at `max-width: ~68ch` (62–72ch for Cyrillic) instead of a % of screen.
   - **No canvas glow** (TYP-8): drop the amethyst focus glow on the writing panel border.
   - **Freeze background animation** (TYP-9): stop the infinite `ThemeBackground` animation on the writing page.
   - **Quiet peripheral motion** (MOT-2, MOT-4): FlowPulse → a debounced ambient glow (2–3s of silence) instead of per-keystroke; sync-status dot static (no pulse) while writing.
3. When `silenceMode` is OFF → current behavior unchanged (gamification/HUD/motion as today).
4. Label it clearly as **(бета)**. One toggle controls the whole bundle (don't split into 6 toggles for now).

**Acceptance:** default install = today's experience (gamification, HUD, zen-on-timeout as-is); flipping «Режим тишины (бета)» ON quiets the writing surface per the bundle; flipping OFF restores; all reduced-motion-safe.

---

# Batch C — Light theme parity

## DGN-7 — Fix invisible/low-contrast elements on the light theme (CLR-3..7, CLR-10..12, MOB-8) 🟠
**Context:** on the light theme (`theme-notion`, #FAF8F5) several elements are invisible or fail contrast. All are hardcoded colors that ignore the theme tokens.
**Fix each to a token that has a real light value:**
1. **CLR-3** `ConnectionStatusBanner.tsx:60-81` — `amber-400`/`emerald-400` (1.57:1 / 1.81:1) → `text-accent-warning bg-accent-warning/10` etc. (offline status is critical).
2. **CLR-4** `Achievements.tsx:22-27,249` — `legendary #f5c518` hardcoded + `common: rgba(255,255,255,0.5)` (1.03:1) → `--accent-warning` / `--text-muted`.
3. **CLR-5** `index.css:224` sidebar icons `text-text-main/40` (2.55:1) → raise to ≥3:1 (a dedicated token or `/60`).
4. **CLR-6** `Button.tsx:35` focus ring `brand-primary/50` (1.75:1) → use the global focus-visible treatment / a higher-contrast ring.
5. **CLR-7** `Toggle.tsx:23` off-track `bg-white/20` (1.01:1, invisible on light) → a token that reads in both themes.
6. **CLR-10** `ThemeBackground.tsx:5-29` — no background for `notion`/`stripe` (flat white) → give them a proper light background (or intentional flat, but not a broken gap).
7. **CLR-11** `Achievements.tsx:25` `epic: var(--flow-pulse-color)` — semantic token leak → a dedicated rarity token.
8. **CLR-12** `Heatmap.tsx:110` meaning-by-color-only (WCAG 1.4.1) → add a non-color cue (intensity label/aria); Mobile*Screen `#0b0d0c` dark fallback → token.
9. **MOB-8** `MobileFocusScreen.tsx:101` hardcoded dark text → token (invisible on light).
**Acceptance:** switch to the light theme and walk the app — toggles, status banners, focus rings, sidebar icons, achievements, heatmap, mobile focus screen are all visible and ≥ their WCAG targets; no element disappears.

## DGN-8 — Token discipline for color literals (CLR-9) 🟡 (optional, larger)
**Context:** ~51 off-token Tailwind colors + ~23 raw hex across `src/features/**` break theme portability.
**Fix:** replace off-token color literals with semantic tokens; where a needed token is missing, add it to all theme blocks. Optionally add an ESLint rule flagging raw hex / non-token Tailwind color classes in `src/features/**`.
**Acceptance:** no raw hex / off-token color classes remain in `src/features/**` (or a documented allowlist); themes stay consistent. *(Can be deferred if it balloons — DGN-7 is the priority.)*

---

# Batch D — Russian typography

## DGN-9 — Live Russian typography substitution (opt-out toggle) (TYP-4) 🟡
**Context:** `WritingEditor.tsx:97` stores the raw textarea value; there's no smart-punctuation. The brand itself is set in « ».
**Tasks:**
1. Add a **«Типографика»** toggle in `EditorTab.tsx` (default **ON** — owner writes in Russian and wants it), persisted in settings.
2. When on, substitute on input: straight `"` → « » (open/close by preceding-char context; use „ " for nested), `--` → —, `...` → …, and `-` between spaces → — (en/em dash per Russian rules). Hook into the editor `onChange`/input path.
3. **Handle it carefully:** preserve caret position after substitution (don't jump the cursor), don't fight the user's own «»/— if already typed, and don't mangle URLs or code-looking runs if easy to detect. Substituting only the just-typed trigger char (not reprocessing the whole doc each keystroke) keeps caret + undo sane.
4. Never break undo — a normal input event so the browser's undo stack stays usable (or apply via the store consistently).
**Acceptance:** with the toggle on, typing `"привет"` yields «привет», `--` yields —, `...` yields …; the caret stays put; undo works; turning the toggle off leaves raw characters.

---

### Explicitly out of scope (owner calls)
- **TYP-1 / Lora** — font stays **Inter**.
- **MOB-1 layout mode** — do NOT touch (needs desktop-app testing first).
- Gamification is **default-on** — do NOT make streaks/achievements/WPM opt-in; only the silence bundle (Batch B) is opt-in.
