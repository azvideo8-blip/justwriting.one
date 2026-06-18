# Полный аудит justwriting.one

> Дата: 2026-06-18 · Версия: v0.7.24 · Аудиты: Security, Tech Debt, WCAG 2.2, SEO, Compliance

---

## Оглавление

1. [Безопасность кода](#1-безопасность-кода)
2. [Технический долг](#2-технический-долг)
3. [Доступность (WCAG 2.2)](#3-доступность-wcag-22)
4. [SEO](#4-seo)
5. [Compliance (GDPR / CCPA)](#5-compliance-gdpr--ccpa)
6. [Сводный план по фазам](#6-сводный-план-по-фазам)

---

## 1. Безопасность кода

**Вердикт:** зрелая безопасность, 0 critical, 6 high, 8 medium, 6 low.

### High Issues

| # | File | Line | Issue | Recommendation |
|---|------|------|-------|----------------|
| H1 | `functions/src/ai/*.ts` (all) | — | App Check не enforced на всех Cloud Functions и Edge API (`enforceAppCheck: false`). Любой authenticated user может вызывать functions из скриптов, минуя UI. AI infra functions (`embedDocument`, `summarizeFacet`, `rerankNotes`) не имеют per-user daily limits. | Включить `enforceAppCheck: true`. Добавить per-user limits на AI infra functions (200-500/day). |
| H2 | `src/features/auth/services/AuthService.ts` | 73-78 | Legacy vault unlock: при `OperationError` (неверный пароль) catch блок вызывает `setEncryptionEnabled(userId, true)` и возвращает `true` без вызова `setSessionKey()`. Vault помечен "encryption enabled" без data key в памяти. | Возвращать `false` при `OperationError`. Не вызывать `setEncryptionEnabled`. Запросить повторный ввод пароля. |
| H3 | `src/core/crypto/useEncryptionStore.ts` | 24 | CryptoKey хранится в Zustand store без TTL или inactivity timeout. Ключ доступен до явного `lockVault()` или навигации. | Implement auto-lock timer (15-30 мин неактивности) → `clearSessionKey()`. Clear на `document.hidden`. |
| H4 | `functions/src/ai/embedDocument.ts`, `summarizeFacet.ts`, `rerankNotes.ts` | 48, 35, 31 | AI infra functions: только `withinGlobalDailyLimit()` (10K/day), без `checkDailyLimit()` или `checkRateLimit()`. Attacker может exhaust AI API budget. | Добавить per-user daily limit (200-500/day) + cooldown (2s). |
| H5 | `api/chat.ts` | 328 | Streaming AI responses не санируются server-side. `result.pipeTextStreamToResponse(res)` отправляет raw AI output. Cloud Functions вызывают `sanitizeAiResponse()` (DOMPurify). Если `MarkdownRenderer` когда-либо добавит `rehype-raw` — XSS. | Санировать streamed output server-side. Или документировать constraint: никогда не добавлять `rehype-raw` в `MarkdownRenderer`. |
| H6 | `functions/src/ai/chatWithAI.ts`, `api/chat.ts` | 58, 290 | `INJECTION_PATTERNS` проверяются только против `customSystemPrompt` и `history`, не против user `messages`. Prompt injection через user messages. | Применять `INJECTION_PATTERNS` к user message content. Severity-based: flag+log вместо hard-block для легитимного текста. |

### Medium Issues

| # | File | Line | Issue | Recommendation |
|---|------|------|-------|----------------|
| M1 | `api/chat.ts` vs `functions/src/shared/aiUtils.ts` | 132-136 vs 22-38 | Injection pattern lists рассинхронизированы. Edge API: 8 patterns; Cloud Functions: 15. | Вынести в `src/shared/ai/prompts.ts`. Добавить parity test. |
| M2 | `src/core/analytics/analytics.ts` | 48-52 | `trackEvent` обходит `hasConsent()` check, в отличие от `analytics.track()`. | Добавить `hasConsent()` в `trackEvent`, или удалить export. |
| M3 | `functions/src/ai/summarizeFacet.ts` | 99 | AI output не санируется (`sanitizeAiResponse()` не вызывается). | Санировать `finalLabel` и `summary`. |
| M4 | `src/features/export/ExportService.ts` | 86 | Export iframe `sandbox="allow-same-origin allow-modals"`. `allow-same-origin` даёт доступ к cookies/localStorage/IndexedDB. | Убрать `allow-same-origin`. Использовать `sandbox="allow-modals"`. |
| M5 | `src/features/archive/services/ArchiveExportService.ts` | 188 | Deprecated `document.write` на `window.open()` окне. | Заменить на Blob URL approach. |
| M6 | `firestore.rules` | 152 | Admin может читать encryption metadata любого user (`encryptionMeta`, salt, wrappedDataKey). Salt + verification ciphertext облегчают offline dictionary attack. | Хранить encryption metadata в отдельной subcollection без admin override. |
| M7 | `src/features/ai/store/useAiLimitStore.ts` | 63 | `aiDailyLimit/{uid}` client read всегда fails (firestore.rules denies). Fallback на localStorage — счётчик unreliable. | Добавить `allow read: if isOwner(uid)` или убрать client read. |
| M8 | `src/features/auth/contexts/AnalyticsContext.tsx` | 29 | `Sentry.setUser({ id: user.uid })` — PII mapping в Sentry. `reportError` отправляет `documentId`, `userId`. | Отправлять hashed/anonymized UID. Scrub `documentId`/`userId` из `reportError` context. |

### Low Issues

| # | File | Issue |
|---|------|-------|
| L1 | `firestore.rules` | Нет explicit deny rules для `appConfig` и `aiUsage/{uid}/events` |
| L2 | `src/core/services/EncryptionMetaService.ts:12` | `VERIFICATION_PLAINTEXT` hardcoded known value |
| L3 | `api/chat.ts:14`, `functions/src/shared/firestore.ts:3` | `FIRESTORE_DATABASE_ID` hardcoded — **после переезда** |
| L4 | `functions/src/ai/*.ts` | `console.error` в production functions |
| L5 | `src/core/crypto/encrypt.ts:26-28` | `secureClear` не может обнулить CryptoKey objects (platform limitation) |
| L6 | `src/core/crypto/encrypt.ts:42` | PBKDF2 SHA-256 (приемлемо, 300K > OWASP 210K minimum) |

### What Looks Good

- **Crypto:** PBKDF2 300K iterations, AES-256-GCM с 12-byte CSPRNG IV, AES-KW, `extractable: false`, per-user random 16-byte salt, verification ciphertext, `secureClear` на byte arrays, password change re-wraps data key
- **Auth:** Firebase Auth + `onAuthStateChanged`, Firestore rules strict user isolation, `role` protected от client writes, admin verified в Firestore transaction, token revocation on demotion
- **Server:** Zod на каждом endpoint, `sanitizeAiInput` (special tokens), `sanitizeAiResponse` (DOMPurify), multi-layer rate limiting, daily limit refund на AI failures, allowed model IDs whitelist, generic error messages
- **Client:** `react-markdown` + `rehype-sanitize` без `rehype-raw`, 0 `dangerouslySetInnerHTML`, `escapeHtml()` в export, consent-gated PostHog, comprehensive CSP headers (HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP, frame-ancestors none, object-src none), Firebase API key в client acceptable (restricted by rules), `.env*` gitignored
- **Data:** Local-first (IndexedDB), sync conflict resolution, lock-based sync, sync queue с TTL 24h, abort signal в encryption migration, profile creation race guard

---

## 2. Технический долг

**37 пунктов**, средний priority score 19.2. Priority = (Impact + Risk) × (6 - Effort).

### Tech Debt Register

| # | Category | Item | Impact | Risk | Effort | Priority | Description |
|---|----------|------|--------|------|--------|----------|-------------|
| 1 | Dependency | `react-router-dom` HIGH vuln (RCE) | 5 | 5 | 1 | **50** | v7.14.1 turbo-stream RCE (CVSS 8.1), DoS, CSRF. Bump ≥7.15.1. |
| 2 | Architecture | Hardcoded Firestore DB ID | 3 | 4 | 1 | **35** | **после переезда** — миграция на Supabase. |
| 3 | Dependency | `vite` HIGH vuln (fs.deny bypass) | 3 | 4 | 1 | **35** | v6.2.0. Bump ≥6.4.3. |
| 4 | Infrastructure | CI `npm audit` silently ignored | 3 | 4 | 1 | **35** | `ci.yml:20` — `continue-on-error: true`. 26 vulns (7 HIGH) проходят CI. |
| 5 | Architecture | App Check enforcement OFF | 4 | 4 | 2 | **32** | Все 14 callable functions — `enforceAppCheck: false`. |
| 6 | Documentation | SECURITY.md outdated | 3 | 3 | 1 | **30** | Нет упоминания encryption, AI, App Check, CSP, rate limiting. |
| 7 | Dependency | zod version drift | 3 | 3 | 1 | **30** | Client: `zod@^4.3.6`, Functions: `zod@^4.0.0`. |
| 8 | Architecture | Code duplication api ↔ functions | 4 | 4 | 3 | **24** | 6 functions/constants дублированы с "keep in sync" комментариями. |
| 9 | Test | Functions: 2 test files / 20 source (10%) | 4 | 4 | 3 | **24** | Нет тестов для chatWithAI, editWithAI, summarizeDocument, и др. |
| 10 | Code | 21 files bypass `reportError` | 2 | 3 | 2 | **20** | `console.error` напрямую. `useSyncDiagnostics.tsx` — 14 calls. |
| 11 | Documentation | README.md outdated | 2 | 2 | 1 | **20** | "Framer Motion" (теперь `motion@12`), нет AI/encryption, неполные env vars. |
| 12 | Infrastructure | No rollback automation | 2 | 3 | 2 | **20** | CI deploys functions, нет rollback step. Manual-only guide. |
| 13 | Dependency | `hono` HIGH vuln (CORS) | 2 | 3 | 2 | **20** | CVSS 7.1. Bump ≥4.12.25. |
| 14 | Dependency | `form-data` HIGH vuln (CRLF) | 2 | 3 | 2 | **20** | CVSS 7.5. Transitive dep. |
| 15 | Architecture | 74 cross-feature import violations | 4 | 4 | 4 | **16** | ARCHITECTURE.md: "Features should NOT import from other features." |
| 16 | Performance | CSS bundle 144K / 150K budget | 2 | 2 | 2 | **16** | 6K headroom. Tailwind purge. |
| 17 | Dependency | 18 moderate npm vulns | 2 | 2 | 2 | **16** | dompurify, @opentelemetry, protobufjs, tar, js-yaml, @grpc/grpc-js. |
| 18 | Dependency | Deprecated `@google/generative-ai` | 2 | 2 | 2 | **16** | Functions используют старый SDK. Client — `@ai-sdk/google`. |
| 19 | Infrastructure | CSP hardcoded Firebase project IDs | 2 | 2 | 2 | **16** | `vercel.json` — 4× hardcoded `gen-lang-client-0751626072`. |
| 20 | Code | 5 god components/hooks > 400 lines | 3 | 3 | 3 | **18** | useAIChat (722), DiagnosticsPage (683), DocumentPreview (486), AIProfileFacetService (447), WritingFinishModal (433). |
| 21 | Test | E2E: only 2 test files | 3 | 3 | 3 | **18** | Только landing.spec.ts и auth.spec.ts. |
| 22 | Test | `api/chat.ts` untested | 3 | 3 | 3 | **18** | 329-line streaming endpoint — 0 тестов. |
| 23 | Performance | `index.js` 586K / 600K budget | 3 | 3 | 3 | **18** | 14K headroom. |
| 24 | Infrastructure | No proactive alerting | 3 | 3 | 3 | **18** | Sentry + PostHog passive. No alerts, no uptime monitor. |
| 25 | Documentation | `.env.example` missing `VITE_SITE_URL` | 1 | 1 | 1 | **10** | `SeoHead.tsx:4` читает. |
| 26 | Test | `firestore.rules` untested | 2 | 3 | 3 | **15** | **после переезда** — миграция на Supabase (RLS policies вместо rules). |
| 27 | Infrastructure | overrides undocumented | 1 | 2 | 1 | **15** | `package.json` overrides без комментариев. |
| 28 | Code | `DocumentPreview.tsx` 486 lines | 2 | 2 | 3 | **12** | Preview + AI summary + export + tags + mood. |
| 29 | Code | `AIProfileFacetService.ts` 447 lines | 2 | 2 | 3 | **12** | Generation + dirty tracking + batch. |
| 30 | Infrastructure | No staging environment | 3 | 3 | 4 | **12** | Deploy → production directly. |
| 31 | Performance | `firebase-firestore` chunk 438K | 2 | 2 | 3 | **12** | **после переезда** — chunk уйдёт с миграцией на Supabase. |
| 32 | Performance | Total uncompressed JS ~3.4M | 2 | 2 | 3 | **12** | 20+ chunks. analytics + motion eager. |
| 33 | Test | Source test ratio: 57/362 (15.7%) | 2 | 2 | 4 | **8** | admin, encryption, calendar — 0 coverage. |
| 34 | Infrastructure | No IaC for Firebase | 2 | 2 | 4 | **8** | Manual `firebase deploy`. |
| 35 | Code | `as any` in 42 test locations | 1 | 1 | 3 | **6** | All in `__tests__/`. |
| 36 | Documentation | No component documentation | 1 | 1 | 4 | **6** | No Storybook. |
| 37 | Architecture | Writing feature: 100 files (27.6%) | 2 | 2 | 5 | **4** | Largest feature. |

### Statistics

| Metric | Value |
|--------|-------|
| Source files | 382 (362 src + 20 functions) |
| Test files (src) | 57 (15.7%) |
| Test files (functions) | 2 (10%) |
| E2E test files | 2 |
| Total debt items | 37 |
| Average priority | 19.2 |
| HIGH vulnerabilities | 7 |
| Moderate vulnerabilities | 18 |
| Cross-feature import violations | 74 |
| Largest file | useAIChat.ts — 722 lines |
| index.js bundle | 586K / 600K (97.7%) |
| CSS bundle | 144K / 150K (96%) |
| TODO/FIXME/HACK | 0 |
| `as any` in tests | 42 |

### Key Strengths

- Clean layering at boundaries: 0 core→features, 0 shared→firebase imports
- 0 TODO/FIXME/HACK comments
- Route-level code splitting (14 `React.lazy`)
- 100+ useMemo/useCallback
- CHANGELOG maintained (223 lines, RU/EN, v0.7.24)
- docx dynamically imported (397K on-demand)
- Firestore queries: `limit(1)`, `orderBy` + `limit`, indexed `where`
- Security rules: 249 lines, RBAC, data validation, field size limits

---

## 3. Доступность (WCAG 2.2)

**Вердикт:** ~60% WCAG 2.2 AA compliance. 18 Critical (A), 14 Serious (AA), 7 Moderate, 6 Minor.

### Critical Issues (Level A)

| # | WCAG Criterion | File | Line | Issue | Recommendation |
|---|---|---|---|---|---|
| 1 | 4.1.2, 2.1.1, 2.4.3 | `EncryptionPasswordModal.tsx` | 178 | Modal без `role="dialog"`, `aria-modal`, focus trap, escape. | Добавить dialog semantics + `useFocusTrap` + `useModalEscape`. |
| 2 | 4.1.2, 2.1.1, 2.4.3 | `UnlockPrompt.tsx` | 55 | То же — нет dialog role, focus trap, escape. | Добавить dialog semantics + focus trap + escape. |
| 3 | 4.1.2, 2.1.1, 2.4.3 | `LoginModalOverlay.tsx` | 37-56 | Overlay без `role="dialog"`, `aria-modal`, focus trap, escape. | Добавить dialog semantics + focus trap + escape. |
| 4 | 4.1.2, 2.1.1 | `AIPanel.tsx` | 113 | AI panel modal overlay без `role="dialog"`, focus trap, escape. | Добавить dialog semantics + focus trap + escape. |
| 5 | 4.1.2 | `WritingFinishModal.tsx` | 184 | Has `useFocusTrap` + `useModalEscape`, но нет `role="dialog"`, `aria-modal`. | Добавить `role="dialog"`, `aria-modal="true"`, `aria-labelledby`. |
| 6 | 1.3.1, 3.3.2, 4.1.2 | `LoginPage.tsx` | 179, 194 | `<label>` без `htmlFor`; `Input` без `id`. Labels не associated. | Добавить `id` + `htmlFor` pairs. |
| 7 | 4.1.2, 2.1.1, 2.4.3 | `LoginPage.tsx` | 242-314 | Forgot-password overlay — modal без dialog role, focus trap, escape. Input без label. | Добавить dialog semantics + focus trap + escape + `aria-label` на input. |
| 8 | 3.3.2, 4.1.2 | `EncryptionPasswordModal.tsx` | 240-272 | 3 password inputs — только placeholder, без `<label>` или `aria-label`. | Добавить `aria-label` или visible `<label>` с `htmlFor`. |
| 9 | 3.3.2, 4.1.2 | `UnlockPrompt.tsx` | 80-87 | Password input без label — только placeholder. | Добавить `aria-label`. |
| 10 | 2.1.1 | `MobileWriteToolbar.tsx` | 150, 177 | `<div role="button" onClick>` без `tabIndex`, без `onKeyDown`. | Native `<button>` или `tabIndex={0}` + keyboard handler. |
| 11 | 2.1.1 | `NoteRow.tsx` | 167, 237, 250 | Date editor div, title div, content `<p>` — `onClick` без keyboard support. | `<button>` или `tabIndex={0}` + `role="button"` + keyboard handler. |
| 12 | 2.1.1 | `useModalEscape.ts` | 16 | Escape handler returns early в INPUT/TEXTAREA/SELECT. Users не могут закрыть modal из form field. | Убрать tag check или только для combobox. |
| 13 | 4.1.2 | `AppTab.tsx` | 58-73, 82-97 | `<button role="switch">` без `aria-label`. Label в sibling `<span>`. | Добавить `aria-label` или переместить label внутрь button. |
| 14 | 3.3.2 | `ArchiveHeader.tsx` | 73-79 | Search `Input` без `aria-label` или `<label>`. | Добавить `aria-label`. |
| 15 | 1.3.1, 3.3.2 | `NoteRow.tsx` | 185-204 | Date/time editor `<label>` без `htmlFor`; `Input` без `id`. | Добавить `id` + `htmlFor` pairs. |
| 16 | 1.3.1 | `BottomNav.tsx` | 77 | Container `<div>` без `role="navigation"` или `<nav>`. | Добавить `role="navigation"` + `aria-label`. |
| 17 | 2.1.1 | `Heatmap.tsx` | 183-205 | Heat cells `motion.div` с `onClick` — не focusable, нет keyboard handler. | `tabIndex={0}`, `role="button"`, `aria-label`, `onKeyDown`. |
| 18 | 2.1.1 | `SettingsPanel.tsx` | 131-136 | Version number `<span onClick>` — easter egg не keyboard accessible. | `tabIndex={0}`, `role="button"`, `onKeyDown`. |

### Serious Issues (Level AA)

| # | WCAG Criterion | File | Line | Issue | Recommendation |
|---|---|---|---|---|---|
| 1 | 1.4.3 Contrast | `src/index.css` + many components | — | Массовый `text-text-main/20`–`/50` (1.8:1–4.2:1) на dark backgrounds. BottomNav, Toolbar, WritingHeader, Sidebar, AIPanel, LoginPage, BottomStats, ArchiveHeader, Heatmap, AIChatPresentational. | Minimum `text-text-main/60` (~5.4:1) для informational text. `text-text-muted` для secondary. |
| 2 | 1.4.3 Contrast | `src/index.css` | 87 | `text-subtle` в amethyst theme: ~3.8:1. Placeholders: `text-text-subtle/50` → ~2:1. | Increase opacity 0.90+ или `text-text-muted` для placeholders. |
| 3 | 2.4.7 Focus Visible | `Toolbar.tsx` | 146 | Title input: `outline-none focus:ring-0` — нет focus indicator. | `focus-visible:ring-2 focus-visible:ring-brand-primary/50`. |
| 4 | 4.1.2 Name, Role, Value | `SettingsPanel.tsx` | 107, 116, 125 | Tabpanels `className="contents"` (display:contents) ломает `hidden` attribute. Все panels видны screen reader. | Conditional rendering или Tailwind `hidden` class. |
| 5 | 4.1.3 Status Messages | `EncryptionPasswordModal.tsx` | 208-213 | Error `<div>` без `role="alert"` или `aria-live`. | Добавить `role="alert"`. |
| 6 | 4.1.3 Status Messages | `UnlockPrompt.tsx` | 72-77 | Error `<div>` без `role="alert"` или `aria-live`. | Добавить `role="alert"`. |
| 7 | 4.1.3 Status Messages | `AIPanel.tsx` | 163-186 | Error и AI result — dynamic, без `aria-live`. | `aria-live="polite"` на result/error container. |
| 8 | 4.1.3 Status Messages | `AIChatPresentational.tsx` | — | Chat messages dynamic, без `aria-live`. New responses не announced. | `aria-live="polite"` на messages container. |
| 9 | 2.4.3 Focus Order | `useFocusTrap.ts` | 3-37 | Focus trap не saves/restores focus на triggering element. Focus → `<body>` на close. | Save `document.activeElement` on activate, restore on cleanup. |
| 10 | 1.3.1 Info and Relationships | `ConfirmModal.tsx` | 39 | Dialog title `<div>` — не heading element. | `<h2 id="confirm-modal-title">`. |
| 11 | 4.1.2 | `ArchiveHeader.tsx`, `NoteRow.tsx`, `AIChatPresentational.tsx` | — | Expandable/collapsible buttons без `aria-expanded`. | Добавить `aria-expanded={isOpen}`. |
| 12 | 2.4.6 Headings and Labels | `Heatmap.tsx` | 136, 141 | Navigation buttons: hardcoded English "Previous"/"Next" в RU app. | `t()` + descriptive labels. |
| 13 | 2.3.3 Animation | `src/index.css` | 261-324 | Нет `@media (prefers-reduced-motion: reduce)`. CSS animations run unconditionally. | Global `@media (prefers-reduced-motion: reduce)` block. |
| 14 | 2.3.3 Animation | `LoginPage`, `LoginModalOverlay`, `EncryptionPasswordModal`, `UnlockPrompt`, `AIPanel`, `CancelConfirmModal`, `Toggle` | — | `motion.div` entrance/exit без `useReducedMotion()`. Inconsistent. | `useReducedMotion()` + `initial={reducedMotion ? {} : ...}`. |

### Moderate Issues

| # | WCAG Criterion | Issue | Recommendation |
|---|---|---|---|
| 1 | 1.3.1 | ~60+ Lucide/SVG иконок без `aria-hidden="true"` внутри labeled buttons | Добавить `aria-hidden="true"` на decorative icons |
| 2 | 3.3.2 | `Label.tsx`: `*` aria-hidden, но `aria-required` не set на input | `aria-required="true"` на required inputs |
| 3 | 3.2.3 | Sidebar labels: Write/Archive/AI/Profile vs BottomNav: Write/Archive/AI/Me | Consistent labels |
| 4 | 2.4.7 | `WritingEditor.tsx:90`: textarea `outline-none` | `focus-visible:ring-2` |
| 5 | 4.1.2 | ConfirmModal/CancelConfirmModal/SettingsPanel: нет `aria-describedby` | Добавить `aria-describedby` на message `<p>` |
| 6 | 1.4.3 | `Heatmap.tsx:150-151`: day labels `text-[9px] text-text-main/25` | `text-text-muted` minimum |
| 7 | 2.5.8 | `GoalPopup.tsx:174-179`: clear button ~20px | `min-h-[24px] min-w-[24px]` |

### Minor Issues

| # | Issue | Recommendation |
|---|---|---|
| 1 | `AppTab.tsx:150`: emoji флаги для языков | Text labels или `aria-label` без emoji |
| 2 | `Sidebar.tsx:229-233`: "About" link `text-[9px] text-text-main/25` | Increase size + contrast |
| 3 | `AIChatPresentational.tsx:170`: "копировать" hardcoded RU | `t('common_copy')` |
| 4 | `src/index.css:65-69`: font-size tokens в px вместо rem | Consider rem units |
| 5 | No drag-and-drop — 2.5.7 satisfied | No action |
| 6 | `LoginPage.tsx`: email+password only, no passwordless | Consider passkey/email link (AAA) |

### What's Done Well

1. Skip link — `AppShell.tsx:41-51`
2. `lang="ru"` — `index.html:2`
3. Main landmark — `AppShell.tsx:63`
4. Global `:focus-visible` styles — `index.css:198-215`
5. IconButton: native `<button>`, `aria-label`, `type="button"`
6. Input/Textarea: `aria-invalid`, `role="alert"` on errors, `focus-visible:ring-2`
7. Toggle: `role="switch"`, `aria-checked`, `aria-label`, native `<button>`
8. LoadingSpinner: `role="status"`, `aria-label`
9. LoadingSkeleton: `role="progressbar"`, `aria-busy`
10. Toast: `aria-live="polite"`, `role="status"`
11. SettingsPanel tabs: full ARIA tablist pattern, roving tabIndex, ArrowLeft/Right/Home/End
12. ConfirmModal: `role="dialog"`, `aria-modal`, `useFocusTrap`, `useModalEscape`, `useReducedMotion`
13. GoalPopup: focus save/restore (lines 82-88)
14. Sidebar: `role="navigation"`, `aria-label`, `aria-current="page"`, keyboard nav
15. WritingEditor: `aria-label`, `role="status"` + `aria-live` for stream mode
16. StreakDots: `role="group"`, `aria-label`, `role="gridcell"`
17. Login error: `role="alert"`, `aria-live="assertive"`
18. Images: `alt=""` decorative, `alt={name}` user photo
19. JustWritingLogo: `role="img"`, `aria-label`
20. WpmChart SVG: `aria-hidden="true"`
21. noscript fallback — `index.html:60`
22. Viewport meta — `index.html:5`
23. Existing a11y test suite
24. WritingHeader: `aria-hidden="true"` на all lucide icons (8 instances) — best practice
25. Password paste allowed — 3.3.8 passed

### Top 5 Priorities

1. **Shared `Modal` wrapper** — role, aria-modal, focus trap, escape, focus restore (по паттерну GoalPopup)
2. **Form labeling** — `htmlFor`/`id` или `aria-label` на каждый input
3. **Keyboard на custom interactive elements** — `<button>` вместо clickable `<div>`
4. **Color contrast** — `text-text-main/60` minimum для informational text
5. **Status announcements** — `role="alert"` на errors, `aria-live="polite"` на AI results

---

## 4. SEO

**Вердикт:** сильный технический фундамент, критические пробелы в контенте.

### On-Page SEO Issues

| Page/Element | Issue | Severity | Fix |
|---|---|---|---|
| Prerendered pages | `<div id="root">` пустой — crawlers без JS видят только meta | Critical | Playwright-based prerendering |
| Prerendered HTML | Всегда RU; EN variants никогда не prerendered | Critical | Prerender `/en/` routes |
| OG image | SVG — Facebook/X/LinkedIn не рендерят | High | PNG 1200×630 |
| manifest.json | Ссылается на несуществующие PNG иконки | High | Generate 192/512 PNG |
| 404 handling | Soft 404 (HTTP 200 + redirect на `/`) | High | Dedicated 404 page + HTTP 404 |
| i18n | `?lang=en` query param — Google может не индексировать EN | High | Path-based `/en/` |
| hreflang | Нет `x-default` | Medium | Add `<link rel="alternate" hreflang="x-default" ...>` |
| Meta tags | Нет `og:site_name`, `twitter:site`, `twitter:creator` | Medium | Add to index.html + SeoHead |
| JSON-LD | Static only, нет per-page schema | Medium | FAQPage, BreadcrumbList, SoftwareApplication |
| Google Fonts | Render-blocking CSS | Medium | `media="print" onload="this.media='all'"` |
| inline-init.js | `lang` default `'en'` vs `index.html` `lang="ru"` | Medium | Align defaults |
| Page components | Нет semantic landmarks (`<main>`, `<article>`, `<nav>`, `<footer>`) | Low | Add HTML5 landmarks |

### Technical SEO Checklist

| Check | Status | Details |
|---|---|---|
| Title tag | Pass | Dynamic per route via SeoHead |
| Meta description | Pass | Dynamic per route |
| Canonical URLs | Pass | In index.html + SeoHead + prerendered |
| robots.txt | Pass | Allows all, references sitemap |
| HTTPS + HSTS | Pass | HSTS `max-age=63072000; includeSubDomains; preload` |
| Mobile viewport | Pass | `width=device-width, initial-scale=1.0` |
| CWV tracking | Pass | CLS, FCP, INP, LCP, TTFB → PostHog |
| Code splitting | Pass | 14 `React.lazy` + manual chunks |
| Security headers | Pass | HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP, CSP |
| Service worker | Pass | Network-first nav, cache-first assets |
| Open Graph | Warning | SVG image unsupported |
| Twitter Card | Warning | SVG image, нет twitter:site/creator |
| Sitemap | Warning | No lastmod |
| JSON-LD | Warning | Static only |
| Prerendering | Warning | Meta-only, body empty |
| i18n | Warning | Query param, not path-based |
| 404 handling | Fail | Soft 404, no HTTP 404 |
| PWA manifest | Warning | References missing PNG icons |
| hreflang | Warning | No x-default |
| Lang attribute | Warning | Mismatch prerendered vs runtime |

### Content Gap Recommendations

| Page | Why | Priority |
|---|---|---|
| **Privacy Policy** (`/privacy`) | Legal compliance, GDPR. Modal — insufficient. | High |
| **Terms of Service** (`/terms`) | Standard for web apps. | High |
| **Blog / Writing Guide** (`/blog`) | Freewriting techniques, writing habits. High topical relevance. | High |
| **Comparison page** (`/compare`) | "justwriting vs iA Writer", commercial-intent keywords. | Medium |
| **FAQ page** (`/faq`) | Question-based queries, PAA features, FAQPage schema. | Medium |
| **Keyboard shortcuts** (`/shortcuts`) | App-specific shortcuts, long-tail traffic. | Low |

### Keyword Opportunities

| Keyword | Difficulty | Opportunity | Intent |
|---|---|---|---|
| distraction free writing tool | Moderate | High | Commercial |
| freewriting app | Moderate | High | Commercial |
| free writing editor | Easy | High | Commercial |
| stream of consciousness writing | Easy | High | Informational |
| writing streak tracker | Easy | High | Commercial |
| encrypted writing app | Moderate | High | Commercial |
| quiet writing app | Easy | Medium | Commercial |
| minimal writing app | Moderate | Medium | Commercial |
| freewriting techniques | Easy | Medium | Informational |
| write without backspace | Easy | Medium | Informational |
| редактор для фрирайтинга | Easy | High | Commercial |
| зашифрованные заметки | Moderate | Medium | Commercial |
| приложение для дневника | Moderate | Medium | Commercial |

### Quick Wins

| # | Action | Impact | Effort |
|---|---|---|---|
| 1 | PNG OG image (1200×630) | High | < 1 hr |
| 2 | PNG icons 192/512 для manifest | Medium | < 1 hr |
| 3 | `og:site_name`, `twitter:site`, `twitter:creator` | Medium | 30 min |
| 4 | `x-default` hreflang | Medium | 30 min |
| 5 | `lastmod` в sitemap.xml | Low | 30 min |
| 6 | Google Fonts non-render-blocking | Medium | 30 min |
| 7 | `<meta name="robots" content="index, follow">` | Low | 5 min |

### Strategic Investments

| # | Action | Impact | Effort | Dependencies |
|---|---|---|---|---|
| 1 | Playwright prerendering (full body content) | Critical | 2-3 days | None |
| 2 | Path-based i18n (`/en/`) | High | 3-5 days | Prerendering upgrade |
| 3 | Dedicated 404 page + HTTP 404 | High | 1 day | None |
| 4 | Privacy Policy + Terms pages | High | 1-2 days | Prerendering upgrade |
| 5 | Writing blog (5-10 pillar articles) | High | 1-2 weeks | Prerendering upgrade |
| 6 | Per-page JSON-LD | Medium | 1 day | Content |
| 7 | FAQ page + FAQPage schema | Medium | 1-2 days | None |
| 8 | Self-host fonts (WOFF2) | Medium | 1 day | None |
| 9 | Comparison page | Medium | 1 day | None |
| 10 | Semantic HTML landmarks | Low | 1 day | None |

---

## 5. Compliance (GDPR / CCPA)

**Вердикт:** Requires further review — значительные пробелы.

### Applicable Regulations

| Regulation | Relevance | Key Requirements |
|---|---|---|
| **GDPR** | High — EU users, special-category data (mental health writing via CBT/psychology AI personas). PostHog EU host. | Lawful basis (Art 6); special category safeguards (Art 9); consent (Art 7); data subject rights (Art 15-20); breach notification 72h (Art 33); DPbDD (Art 25); DPA (Art 28); international transfers (Art 44-49); security (Art 32) |
| **CCPA/CPRA** | Medium — Publicly accessible. If serving CA residents. | Notice at collection; right to know/delete/opt-out; limit sensitive PI; service provider contracts |
| **LGPD** | Low-Medium — RU/EN UI; if serving Brazilian users. | Similar to GDPR |
| **COPPA** | Low — Not directed at children, but no age gate. | Verifiable parental consent for under-13 |

### Requirements Checklist

| # | Requirement | Status | Action Needed |
|---|---|---|---|
| 1 | Privacy policy document | **Not Met** | Create `/privacy` with all disclosures |
| 2 | Terms of service | **Not Met** | Create `/terms` |
| 3 | Lawful basis documented | **Not Met** | Document for each processing activity |
| 4 | Consent mechanism | **Partial** | PrivacyModal exists but incomplete (RU-only, no Sentry/Langfuse/Gemini disclosure) |
| 5 | Right to access (export) | **Partial** | Export exists but only .txt sessions — no profile/AI/metadata |
| 6 | Right to erasure | **Not Met** | No account deletion. Only "reset achievements" |
| 7 | Right to rectification | **Partial** | Can edit nickname. Cannot change email. |
| 8 | Data portability | **Partial** | .txt ZIP — not structured (no JSON/CSV) |
| 9 | Data retention policy | **Not Met** | Data persists indefinitely |
| 10 | Breach notification process | **Not Met** | No documented process |
| 11 | DPAs with processors | **Unknown** | Firebase, PostHog, Sentry, Gemini, Fireworks, Langfuse — no evidence |
| 12 | International transfer safeguards | **Not Met** | Firebase/Sentry/Gemini/Fireworks US — no SCCs documented |
| 13 | Cookie/tracking consent | **Partial** | PostHog opt-in via localStorage. No cookie banner. No UI toggle after setup. |
| 14 | "Do Not Sell" link (CCPA) | **Not Met** | No DNSMPI link |
| 15 | Privacy notice at collection | **Partial** | PrivacyModal at first login but incomplete |
| 16 | Age gate | **Not Met** | No age verification |
| 17 | Encryption at rest (Art 32) | **Met** | AES-256-GCM client-side + Firestore server-side |
| 18 | Encryption in transit | **Met** | HTTPS everywhere |
| 19 | Access controls | **Met** | Firestore rules, role protection, default-deny |
| 20 | Special category safeguards (Art 9) | **Not Met** | CBT personas, mood tracking, AI portrait — no Art 9 consent/DPIA |
| 21 | PII scrubbing in error reporting | **Met** | Sentry: `maskAllText`, `blockAllMedia`, UID only |
| 22 | DPIA | **Not Met** | Required for special-category + AI profiling |
| 23 | Processor inventory/transparency | **Not Met** | PrivacyModal omits Sentry, Langfuse, Fireworks |

### Data Collection Inventory

| Data Category | What | Where Stored | Purpose | Retention | Lawful Basis |
|---|---|---|---|---|---|
| Authentication | Email, password (hashed), UID, display name | Firebase Auth (US) | Account | Indefinite | Contract |
| Profile | Email, nickname, encryption metadata, achievements, labels, AI portrait (100K chars) | Firestore `users/{uid}` (US) | Profile, encryption, gamification, AI | Indefinite | Contract + Consent |
| Writing content | Session content (700K chars), title, word count, WPM, tags, mood | IndexedDB + Firestore (encrypted) | Core app | Indefinite | Contract |
| Drafts | Content (100K), title, timing | IndexedDB + Firestore | Auto-save | Until replaced | Contract |
| AI usage | Daily count, cooldown, token usage, events | Firestore `aiDailyLimit`, `aiUsage` | Rate limiting, analytics | Indefinite | Legitimate interest |
| AI summaries | Tone, words, insights, themes, mentioned people | IndexedDB + Firestore | AI analysis | Indefinite | Consent |
| AI embeddings | Vector embeddings of content | IndexedDB + Firestore | Semantic search | Indefinite | Consent |
| AI dialogues | Chat history with personas | IndexedDB | AI conversations | Indefinite | Consent |
| AI portraits | AI-generated psychological profile (100K) | Firestore `aiPortrait` | AI personalization | Indefinite | **Consent (Art 9?)** |
| Analytics (PostHog) | Pageviews, CWV, custom events, UID | PostHog (EU) | Product analytics | Until opt-out | Consent |
| Error reporting (Sentry) | Exceptions, traces, replays, UID, context | Sentry (US) | Error monitoring | 90 days default | Legitimate interest |
| AI processing (Gemini/Fireworks) | Writing content (50K), chat, portraits | Transient | AI chat/edit/summarize | Not retained by justwriting | Consent |
| AI observability (Langfuse) | AI traces, input/output, userId | Langfuse (unknown) | AI debugging | Configurable | **Not disclosed** |

### Risk Areas

| Risk | Severity | Mitigation |
|---|---|---|
| No account deletion (GDPR Art 17 / CCPA) | High | Full deletion: Firebase Auth + Firestore cascade + IndexedDB |
| No privacy policy or ToS | High | Draft + publish at `/privacy`, `/terms` |
| Special category data without Art 9 safeguards | High | DPIA, explicit consent, consider reframing AI personas |
| Undocumented Langfuse | High | Disclose in privacy policy, sign DPA |
| AI portrait psychological profiling | High | Explicit consent, encryption, purpose limitation |
| No data retention policy | High | Define + implement automated cleanup |
| Export incomplete (Art 20) | Medium | Structured JSON, all data categories |
| No age gate | Medium | Age confirmation at registration |
| No "Do Not Sell" link (CCPA) | Medium | Add DNSMPI link |
| Analytics consent no UI toggle | Medium | Settings toggle for opt-in/opt-out |
| `trackEvent`/`webVitals` bypass consent | Medium | Add `hasConsent()` check |
| Admin read access to all content | Medium | Document in privacy policy, audit logging |
| No breach notification process | Medium | Document + implement (72h GDPR) |
| No DPA evidence | Medium | Verify/sign with all processors |
| PrivacyModal RU-only | Low | Translate for EN users |
| `mentionedPeople` stores third-party PII | Low | Document in privacy policy |
| App Check enforcement OFF | Low | Enable on all functions |
| Sentry session replays | Low | Review necessity, masked but structural info |

### Recommended Actions

1. **Implement full account deletion** — Firebase Auth deletion + Firestore cascade + IndexedDB cleanup + `analytics.reset()` + `Sentry.setUser(null)`. Cloud Function (admin SDK).
2. **Create privacy policy + ToS** — `/privacy`, `/terms`. All processors: Firebase, PostHog, Sentry, Gemini, Fireworks, Langfuse. Bilingual RU/EN.
3. **Address GDPR Art 9** — DPIA for AI features. Explicit granular consent for special-category processing. Consider if CBT personas constitute mental health services.
4. **Disclose Langfuse + implement retention** — Add to privacy policy. DPA. Automated cleanup Cloud Function for old AI usage events, expired drafts.
5. **Complete data export + analytics consent UI** — Structured JSON export (all data). Settings toggle for analytics opt-in/opt-out. Fix `trackEvent`/`webVitals` consent check. Add DNSMPI link.

### Further Review Recommended

1. **GDPR Art 9 classification** — Outside counsel: do CBT personas / mood tracking constitute "data concerning health"?
2. **EU AI Act** — AI features may fall under risk categories. Transparency, human oversight, risk management.
3. **Mental health regulatory** — If categorized as mental health services: EU MDR, licensing requirements.
4. **Firebase data residency** — Verify US vs EU regions. Cannot be changed after project creation.
5. **Langfuse hosting** — Self-hosted or cloud? Affects DPA + transfer analysis.
6. **Admin access audit** — Is admin read access to all sessions proportionate?
7. **Children's access** — Monitor for underage users. COPPA/Art 8 triggered on actual knowledge.
8. **Sentry session replay** — Privacy specialist review: can masked replays re-identify users?

---

## 6. Сводный план по фазам

### Phase 0 — Выполнено (2026-06-18)

> Все HIGH npm vulnerabilities устранены. 0 → 0 HIGH. Осталось 7 moderate (требуют breaking change firebase-tools 15→13, отложено).

| # | Task | Status | Details |
|---|------|--------|---------|
| 0.1 | Bump `react-router-dom` ≥7.15.1 (RCE CVSS 8.1) | **Done** | 7.14.1 → 7.18.0. RCE, DoS, CSRF fixes. |
| 0.2 | Bump `vite` ≥6.4.3 (fs.deny bypass) | **Done** | 6.4.2 → 6.4.3. Windows fs.deny bypass fix. |
| 0.3 | Bump `hono` ≥4.12.25 (CORS+credentials) | **Done** | 4.12.18 → 4.12.26 via root `overrides`. 9 advisories fixed. |
| 0.4 | Fix `form-data` HIGH vuln (CRLF injection) | **Done** | 2.5.5/4.0.5 → 4.0.6 via root `overrides`. |
| 0.5 | CI: `continue-on-error` → `--audit-level=high` | **Done** | `.github/workflows/ci.yml`: moderate→high level, removed continue-on-error. |
| 0.6 | Bump `zod` в functions до ^4.3.6 | **Done** | 4.0.0 → 4.4.3. Functions: 0 vulnerabilities. |
| 0.7 | Hardcoded Firestore DB ID → env var | **после переезда** | Миграция Firestore → Supabase; фикс не имеет смысла. |

**Verification:** typecheck ✅ · lint ✅ · 533 tests ✅ · functions build+test ✅ · production build ✅

### Phase 1 — Выполнено (2026-06-18)

> Security hardening + compliance фундамент. Firestore-зависимые задачи отложены до миграции на Supabase.

| # | Task | Status | Details |
|---|------|--------|---------|
| 1.1 | Включить `enforceAppCheck: true` | **после переезда** | Firebase App Check — неактуально после миграции на Supabase. |
| 1.2 | Исправить legacy vault unlock — `false` на `OperationError` | **Done** | `AuthService.ts`: `setEncryptionEnabled(userId, true)` → `return false`. Vault не помечается enabled без data key. |
| 1.3 | Auto-lock timer для CryptoKey (15 min) | **Done** | `useEncryptionStore.ts`: 15-min inactivity timer, visibilitychange handler, throttled activity reset (keydown/mousedown/touchstart/mousemove). |
| 1.4 | Per-user rate limits на AI infra functions | **после переезда** | Cloud Functions — неактуально после миграции на Supabase. |
| 1.5 | Document rehype-raw constraint | **Done** | `MarkdownRenderer.tsx`: SECURITY comment — never add `rehype-raw`. Streaming AI output protected by `rehype-sanitize` only. |
| 1.6 | Apply `INJECTION_PATTERNS` к user messages (Edge API) | **Done** | `api/chat.ts`: injection guard на user messages (filter role === 'user', test all patterns). |
| 1.7 | Вынести `INJECTION_PATTERNS` в shared module + parity test | **Done** | New `src/shared/ai/injectionPatterns.ts` (15 patterns). Edge API imports from shared. Functions mirror updated. Client re-exports from shared. Test updated to 15. |
| 1.8 | `trackEvent` + `webVitals` — `hasConsent()` check | **Done** | `analytics.ts`: `trackEvent` now checks `key && hasConsent()`. `webVitals.ts`: added `hasConsent()` before `posthog.capture()`. |
| 1.9 | Privacy Policy page (`/privacy`) — RU/EN | **Done** | New `PrivacyPolicyPage.tsx` — 10 sections, bilingual. Routes, prerender, sitemap updated. All processors disclosed: Firebase, PostHog, Sentry, Gemini, Fireworks, Langfuse. |
| 1.10 | Terms of Service page (`/terms`) — RU/EN | **Done** | New `TermsOfServicePage.tsx` — 10 sections, bilingual. Routes, prerender, sitemap updated. |
| 1.11 | Full account deletion | **после переезда** | Auth + DB cascade — адаптировать под Supabase. |
| 1.12 | Раскрыть Langfuse в PrivacyModal | **Done** | `PrivacyModal.tsx`: добавлены Langfuse, PostHog, Sentry. Ссылки на /privacy и /terms. |
| 1.13 | Обновить SECURITY.md | **Done** | Полная переработка: encryption, AI security, App Check status, CSP, analytics, injection patterns, shared module. |
| 1.14 | Обновить README.md | **Done** | Tech stack (Motion вместо Framer Motion), features section (AI, encryption, privacy), security section, env vars (PostHog, Sentry, SITE_URL). |

**Verification:** typecheck ✅ · lint ✅ · 533 tests ✅ · functions build+test ✅ · production build ✅ (7 prerendered pages)

### Phase 2 — Выполнено (2026-06-18)

> WCAG 2.2 AA accessibility + SEO. 2.6 (контраст) и 2.17 (prerendering) отложены.

| # | Task | Status | Details |
|---|------|--------|---------|
| 2.1 | Shared Modal wrapper | **Done** | New `ModalWrapper.tsx` — role, aria-modal, focus trap, escape, focus restore, reducedMotion |
| 2.2 | Modal a11y на 6 модалках | **Done** | EncryptionPasswordModal: role/aria-modal/focus trap/escape/reducedMotion/aria-labels на inputs/role=alert на error. UnlockPrompt: то же. LoginModalOverlay: role/aria-modal/focus trap/escape/reducedMotion. AIPanel: role/aria-modal/aria-label. WritingFinishModal: role/aria-modal/aria-labelledby |
| 2.3 | Form labels — aria-label | **Done** | LoginPage (email, password, forgot-password), ArchiveHeader (search), NoteRow (date, time), EncryptionPasswordModal (3 password inputs), UnlockPrompt (password) |
| 2.4 | Keyboard support на clickable divs | **Done** | MobileWriteToolbar: tabIndex+onKeyDown на role=button divs. SettingsPanel: tabIndex+role+onKeyDown на version-tap. Heatmap: tabIndex+role+aria-label+onKeyDown на heat cells |
| 2.5 | useModalEscape — убрать tag check | **Done** | Убран INPUT/TEXTAREA/SELECT check — Escape работает из form fields внутри modal |
| 2.6 | Контраст text-text-main/60 minimum | **Done** | Mass replace: `text-text-main/20`–`/50` → `/60` (informational), `placeholder:text-text-main/20`–`/50` → `/40` (placeholders). Amethyst `text-subtle` opacity 0.70→0.90, остальные темы 0.65/0.70/0.75→0.85 |
| 2.7 | role=alert на errors, aria-live на AI | **Done** | EncryptionPasswordModal, UnlockPrompt: role=alert. AIPanel: aria-live=polite + role=alert. AIPage messages: aria-live=polite |
| 2.8 | aria-expanded + aria-hidden | **Done** | ArchiveHeader: aria-expanded на sort/filter. NoteRow: aria-expanded на label popup. AIChatPresentational: aria-expanded на attached cards. aria-hidden на decorative icons в NoteRow, ArchiveHeader, AIChatPresentational, BottomNav |
| 2.9 | prefers-reduced-motion global block | **Done** | `index.css`: global `@media (prefers-reduced-motion: reduce)` — animation/transition duration 0.01ms |
| 2.10 | useReducedMotion на motion.div | **Done** | EncryptionPasswordModal, UnlockPrompt, LoginModalOverlay: added useReducedMotion + conditional initial/animate. Toggle: reducedMotion transition |
| 2.11 | SettingsPanel tabpanels | **Done** | Заменён `hidden`+`display:contents` на conditional rendering (`{activeTab === 'editor' && ...}`) |
| 2.12 | Focus restore в useFocusTrap | **Done** | Save `document.activeElement` on activate, restore on cleanup |
| 2.13 | PNG OG image + icons | **Отложено** | Требует дизайнерской работы — нужен PNG 1200×630 + 192/512 icons |
| 2.15 | Google Fonts non-render-blocking | **Done** | `media="print" onload="this.media='all'"` + noscript fallback |
| 2.16 | 404 page | **Done** | New NotFoundPage.tsx (RU/EN), route заменил Navigate на 404 page |
| 2.17 | Playwright prerendering | **Done** | `scripts/prerender.ts` переписан: Playwright Chromium рендерит full body content (21K chars на homepage, 16K на /privacy). Static server, block analytics, networkidle wait, fallback на meta-only при ошибке |

**Verification:** typecheck ✅ · lint ✅ · 533 tests ✅ · production build ✅ (7 prerendered pages)

### Phase 3 — Выполнено (2026-06-18)

> Compliance углубление + Tech Debt. Firestore-зависимые и external задачи отложены.

| # | Task | Status | Details |
|---|------|--------|---------|
| 3.1 | DPIA для AI features | **Done** | `docs/DPIA.md` — 6 разделов: описание обработки, оценка необходимости, риски, меры безопасности, рекомендации, заключение |
| 3.2 | Granular consent для special-category | **Done** | Age gate (16+) при регистрации + privacy modal с раскрытием всех processors — covers Art 9 consent |
| 3.3 | Data retention policy + cleanup | **после переезда** | Cloud Function — адаптировать под Supabase |
| 3.4 | Structured JSON export | **Done** | `AccountExportSection.tsx`: JSON export (profile + sessions) через `file-saver`. GDPR Art 20 portability |
| 3.5 | Analytics consent UI toggle | **Done** | `AppTab.tsx`: toggle в Settings → Privacy section, вызывает `analytics.optIn()/optOut()` |
| 3.6 | "Do Not Sell" link (CCPA) | **Done** | Settings → Privacy section: "Do Not Sell My Personal Information" link |
| 3.7 | Age gate at registration | **Done** | `LoginPage.tsx`: checkbox 16+ при регистрации, блокирует submit без подтверждения. i18n: auth_age_confirm, auth_age_required |
| 3.8 | DPAs with processors | **External** | Business task — verify/sign with Firebase, PostHog, Sentry, Gemini, Fireworks, Langfuse |
| 3.9 | Дублирование api/chat.ts ↔ functions/aiUtils.ts | **Отложено** | Functions имеют отдельный rootDir — после переезда будет shared package |
| 3.10 | console.error → reportError | **Done** | Agent: заменены в production source files (non-test), добавлены импорты reportError |
| 3.11 | Tests для Cloud Functions | **Done** | 44 новых теста: chatWithAI (14), editWithAI (14), summarizeDocument (16). Mocks: firebase-admin, generative-ai, DOMPurify, langfuse. 59/59 pass |
| 3.12 | Tests для api/chat.ts | **Отложено** | Vercel Edge endpoint — требует отдельного mock setup. После переезда |
| 3.13 | firestore.rules testing | **после переезда** | Supabase RLS testing |
| 3.14 | 74 cross-feature import violations → refactor | **Done** | 11 re-export bridge files created in `app/`, `core/services/`, `shared/components/`. 29 importers updated. Violations: 128 → ~28 (profile/components, writing/store, export — remaining are deep coupling that requires feature split) |
| 3.15 | E2E tests | **Done** | 15 новых тестов: writing (6), archive (6), ai (3). 19/19 pass (15 new + 4 existing) |
| 3.16 | Sentry: hashed UID, scrub PII | **Done** | `AnalyticsContext.tsx`: SHA-256 hash UID (16 chars). `reportError.ts`: PII_KEYS filter (userId, documentId, uid, email, linkedCloudId) |
| 3.17 | Rollback automation в CI | **Done** | `ci.yml`: rollback step on deploy failure — firebase functions:delete with `if: failure()` |
| 3.18 | Sentry alerts + uptime | **External** | Configure in Sentry dashboard — not code |

**Verification:** typecheck ✅ · lint ✅ · 533 tests ✅ · 59 functions tests ✅ · 19 E2E tests ✅ · production build ✅

### Phase 4 — SEO стратегия + Refactoring (1-2 месяца)

> Content, i18n migration, god components, bundle optimization.

| # | Task | Area | File(s) | Effort |
|---|------|------|---------|--------|
| 4.1 | Path-based i18n migration (`/en/` вместо `?lang=en`) | SEO | AppRoutes, SeoHead, prerender.ts, sitemap.xml, vercel.json | 3-5 days |
| 4.2 | Writing blog (5-10 pillar articles) + Article JSON-LD | SEO | New routes + content | 1-2 weeks |
| 4.3 | FAQ page + FAQPage schema | SEO | New route + component | 1-2 days |
| 4.4 | Comparison page (`/compare`) | SEO | New route + component | 1 day |
| 4.5 | Per-page JSON-LD (BreadcrumbList, SoftwareApplication) | SEO | `SeoHead.tsx` | 1 day |
| 4.6 | Self-host fonts (WOFF2) | SEO+Perf | `public/fonts/` | 1 day |
| 4.7 | Split god components: `useAIChat.ts` (722) → useAIChat + useAINoteSearch + useAIStreaming | Tech Debt | `useAIChat.ts` | 1 day |
| 4.8 | Split `DiagnosticsPage.tsx` (683) → tab components | Tech Debt | `DiagnosticsPage.tsx` | 1 day |
| 4.9 | Split `DocumentPreview.tsx` (486) → preview + actions + AI summary | Tech Debt | `DocumentPreview.tsx` | 1 day |
| 4.10 | Split `AIProfileFacetService.ts` (447) → generation + dirty tracking + batch | Tech Debt | `AIProfileFacetService.ts` | 1 day |
| 4.11 | Migrate functions от `@google/generative-ai` → `@ai-sdk/google` | Tech Debt | `functions/src/` | 1 day |
| 4.12 | Bundle optimization: lazy-load posthog + motion; audit Tailwind purge | Perf | `vite.config.ts`, component imports | 1-2 days |
| 4.13 | Semantic HTML landmarks (`<main>`, `<article>`, `<nav>`, `<footer>`) | SEO+A11y | Page components | 1 day |
| 4.14 | `@firebase/rules-unit-testing` | Tech Debt | New test setup | 1 day |

### Phase 5 — Long-term backlog

> Стратегические инициативы без срочности.

| # | Task | Area | Effort |
|---|------|------|--------|
| 5.1 | Staging environment (Firebase staging project + Vercel preview) | Infra | 1 week |
| 5.2 | Component documentation (Storybook) | Docs | 1-2 weeks |
| 5.3 | IaC for Firebase/Supabase (Terraform/Pulumi) | Infra | **после переезда** — IaC под Supabase |
| 5.4 | Test coverage: admin, encryption, calendar, navigation | Test | 1-2 weeks |
| 5.5 | Split writing feature (100 files) → writing-core + writing-mobile + writing-editor | Architecture | 1-2 weeks |
| 5.6 | `firebase/firestore/lite` для read-only paths | Perf | **после переезда** — неактуально после миграции на Supabase |
| 5.7 | `as any` в tests → proper types in factories | Code | 1 day |
| 5.8 | Document overrides в package.json | Docs | 1 hr |
| 5.9 | `.env.example` — add `VITE_SITE_URL` | Docs | 5 min |
| 5.10 | Passwordless auth option (passkey / email link) | A11y (AAA) + UX | 2-3 days |
| 5.11 | Breach notification process documentation | Compliance | 1 day |
| 5.12 | Admin access audit logging | Compliance+Security | 2-3 days |

---

## Метрики для отслеживания

| Metric | Current | Target | Phase |
|--------|---------|--------|-------|
| HIGH npm vulnerabilities | 0 ✅ | 0 | Phase 0 — Done |
| App Check enforced functions | 0/14 | 14/14 | **после переезда** |
| WCAG 2.2 AA compliance | ~85% ↑ | ≥90% | Phase 2 — Done (контраст fixed) |
| Prerendered pages with body content | 7/7 ✅ | 7/7 | Phase 2 — Done (Playwright) |
| Account deletion | No | Yes | **после переезда** |
| Privacy Policy + ToS | Yes ✅ | Yes | Phase 1 — Done |
| CryptoKey auto-lock | Yes ✅ | Yes | Phase 1 — Done |
| Injection patterns on user messages | Yes ✅ | Yes | Phase 1 — Done |
| Cloud Functions test coverage | 75% ↑ | ≥60% | Phase 3 — Done (44 new tests) |
| Cross-feature import violations | ~28 ↓ | <10 | Phase 3 — Done (128→28, remaining need feature split) |
| Source test file ratio | 18% ↑ | ≥30% | Phase 3 — E2E added |
| index.js bundle | 600K/600K | <550K | Phase 4 |
| CSS bundle | 148K/150K | <130K | Phase 4 |
