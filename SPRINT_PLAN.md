# Sprint Plan: JustWriting Audit Remediation

**Generated:** 2026-05-25
**Team:** 1 engineer (solo)
**Sprint length:** 1 week
**Interruption buffer:** 10%
**Effective capacity:** ~36h/week (90% of 40h)

---

## Sprint 1: Security & Crash Fixes

**Dates:** Week 1
**Sprint Goal:** Eliminate all critical security holes and runtime crash risks

### Capacity
| Person | Available | Allocation | Notes |
|--------|-----------|------------|-------|
| You | 5 days | 36h | 10% buffer for interrupts |
| **Total** | **5 days** | **36h** | |

### Sprint Backlog
| Priority | Item | Estimate | Source | Dependencies |
|----------|------|----------|--------|--------------|
| P0 | Wrap `/me`, `/archive`, `/profile` routes in `ProtectedRoute` | 1h | S-1 | None |
| P0 | Fix `auth.currentUser!.uid` crash — add null guard in AdminPage | 1h | C-1 | None |
| P0 | Add Zod validation before `as UserProfile` in AuthContext | 2h | Bug 1.4 | None |
| P0 | Add `onSnapshot` error handler with reconnect logic in AuthContext | 3h | Bug 3.1 | None |
| P0 | Create `AuthService` — extract all auth ops from LoginPage, AccountTab, MobileMePage | 8h | Arch-4 | None |
| P1 | Fix `handleCancel` — wrap in `useCallback` | 0.5h | C-3 | None |
| P1 | Remove duplicate `checkGoals` interval from WritingPage.tsx | 0.5h | P-3 | None |
| P1 | Add `noreferrer` to PDF export `window.open` | 0.5h | S-4 | None |
| P2 | Fix `hidden="until-found" as any` — use data attribute instead | 1h | C-6 | None |

**Total estimate:** 17.5h / 36h (49% load)

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| AuthService refactor touches LoginPage (365 lines) | Could break login flow | Write integration test for login before refactoring |
| AuthContext snapshot reconnect could loop | Infinite reconnect attempts | Add exponential backoff + max retry count |

### Definition of Done
- [ ] All P0 items merged
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test:ci` passes
- [ ] Manual test: login → write → save → logout → verify `/me` redirects

---

## Sprint 2: Architecture — Extract Shared Services

**Dates:** Week 2
**Sprint Goal:** Break the "god feature" — move cross-cutting services out of writing/

### Capacity: 36h

### Sprint Backlog
| Priority | Item | Estimate | Source | Dependencies |
|----------|------|----------|--------|--------------|
| P0 | Move 5 services to `core/services/`: DocumentService, StorageService, SyncService, LocalDocumentService, SessionService | 6h | Arch-2, C-1 | Sprint 1 (AuthService) |
| P0 | Fix `Session.createdAt` type → `Timestamp \| Date \| number` + `getCreatedAtMs()` utility | 3h | T-9, C-2 | None |
| P0 | Extract `useProfileStats` hook — consolidate duplicate KPI logic | 3h | I-3, A-2, M-1 | None |
| P1 | Fix `core/` → `features/` inversion: FlowPulse accept prop, SettingsProvider use slot | 3h | Arch-3 | None |
| P1 | Replace all `(s.createdAt as any)?.toDate()` with `getCreatedAtMs()` | 2h | T-1 | createdAt type fix |
| P1 | Fix `(session as any)._isLegacy` — add discriminated union | 1h | T-2 | None |
| P2 | Add per-route ErrorBoundary on complex routes (writing, admin) | 2h | C-4 | None |
| P2 | Update ARCHITECTURE.md — remove feed, add calendar/export, document state conventions | 1h | Arch-1 | None |

**Total estimate:** 21h / 36h (58% load)

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Moving services changes 30+ import paths | Could miss references | Use IDE "move" refactoring + grep for old paths |
| `createdAt` type change touches many files | Type errors cascade | Fix type first, then fix downstream one-by-one |

### Definition of Done
- [ ] No `core/` → `features/` imports remain
- [ ] No `as any` on Timestamp fields
- [ ] `npm run typecheck && npm run lint && npm run test:ci` all pass
- [ ] KPI stats identical on ProfilePage and MobileMeScreen (visual check)

---

## Sprint 3: Performance & State Management

**Dates:** Week 3
**Sprint Goal:** Fix rendering performance during active writing sessions

### Capacity: 36h

### Sprint Backlog
| Priority | Item | Estimate | Source | Dependencies |
|----------|------|----------|--------|--------------|
| P0 | Consolidate zustand selectors in `useBaseWritingSession` with `useShallow` | 2h | P-2 | None |
| P0 | Add virtualization to session lists (react-virtuoso or similar) | 6h | P-1 | Need to add dependency |
| P1 | Wrap `SessionCard` in `React.memo` | 1h | P-5 | None |
| P1 | Deduplicate session data loading — shared cache for ProfilePage + MobileMeScreen | 3h | P-4 | Sprint 2 (useProfileStats) |
| P1 | Document state management convention (zustand vs context) in ARCHITECTURE.md | 1h | Arch-5 | None |
| P2 | Split `WritingFinishModal` (692 lines) into 5 sub-components | 4h | M-4 | None |
| P2 | Split `AccountTab` (615 lines) into 4 sub-components | 3h | M-5 | Sprint 1 (AuthService) |
| P2 | Move loose Writing*.tsx files into `components/` | 1h | Arch-9 | None |
| P2 | Fix content search truncated to 200 chars — search full content | 1h | P-7 | None |

**Total estimate:** 22h / 36h (61% load)

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Virtualization library adds bundle size | ~10-15KB gzipped | Use dynamic import if possible |
| Splitting god components may break existing behavior | Visual regressions | Screenshot before/after comparison |

### Definition of Done
- [ ] No excessive re-renders during writing (verify with React DevTools Profiler)
- [ ] Session list scrolls smoothly with 200+ items
- [ ] All splits pass visual smoke test
- [ ] `npm run ci` passes

---

## Sprint 4: Code Quality & Type Safety

**Dates:** Week 4
**Sprint Goal:** Eliminate `as any` in production code, standardize patterns, remove dead dependencies

### Capacity: 36h

### Sprint Backlog
| Priority | Item | Estimate | Source | Dependencies |
|----------|------|----------|--------|--------------|
| P0 | Create shared Firestore CRUD abstraction (`firestoreOperation<T>`) | 4h | A-1 | Sprint 2 (services in core/) |
| P1 | Replace all `as Record<string, unknown>` + `as string` casts in StorageService with typed encrypt/decrypt | 4h | T-6 | None |
| P1 | Fix double-cast `as unknown as Session` in UnifiedSessionLoader | 1h | T-7 | None |
| P1 | Fix triple-cast chain in SyncService | 1h | T-8 | None |
| P1 | Standardize Firestore date handling — use `toDate()` everywhere | 2h | M-3, I-10 | Sprint 2 (getCreatedAtMs) |
| P1 | Extract shared `<LoadingSkeleton />` component, remove `dangerouslySetInnerHTML` | 2h | M-2, S-3 | None |
| P1 | Remove unused dependencies: `autoprefixer`, `vite-plugin-pwa` | 0.5h | F-1, F-2 | None |
| P1 | Move `rollup-plugin-visualizer` to devDependencies | 0.5h | F-3 | None |
| P2 | Remove dead tsconfig flags (`experimentalDecorators`, `useDefineForClassFields`, `src/LEGACY`) | 0.5h | F-4, F-5, F-6 | None |
| P2 | Clean up unused React imports (44 files) | 1h | O-5 | None |
| P2 | Replace hardcoded Russian string with `t()` call | 0.5h | M-6 | None |
| P2 | Fix `buildSessionPayload` unused `_profile`/`_user` params | 0.5h | A-8 | None |
| P2 | Remove `_archive/` directory from repo | 0.5h | D-6 | None |
| P2 | Fix `resetSession` exported as `finishSession`/`resetAndClear` — confusing aliases | 1h | D-9 | None |
| P2 | Either use or remove `@/` path alias, update imports if keeping | 3h | F-7 | None |
| P2 | Set `@typescript-eslint/no-explicit-any` to `error` in ESLint | 0.5h | F-9 | After all `as any` fixed |

**Total estimate:** 22.5h / 36h (63% load)

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| `no-explicit-any: error` may block development | Can't commit until all `any` removed | Do this last after all other type fixes |
| `@/` path alias migration touches 100+ files | Import paths break | Use codemod (ts-morph) for safe rename |

### Definition of Done
- [ ] Zero `as any` in non-test production code
- [ ] ESLint `no-explicit-any: error` passes
- [ ] No unused dependencies in `package.json`
- [ ] `npm run ci` passes

---

## Sprint 5: Missing Abstractions & Coupling Cleanup

**Dates:** Week 5
**Sprint Goal:** Eliminate remaining cross-feature imports, create shared abstractions

### Capacity: 36h

### Sprint Backlog
| Priority | Item | Estimate | Source | Dependencies |
|----------|------|----------|--------|--------------|
| P0 | Create `EncryptionService` in `core/crypto/` — extract vault ops from AccountTab | 4h | Arch-4 | Sprint 1 (AuthService) |
| P0 | Move business logic out of `shared/`: localDb → `core/storage/`, firestoreSchemas → `core/firebase/schemas/`, firestore-errors → `core/errors/` | 3h | Arch-8 | Sprint 2 (services moved) |
| P1 | Create centralized localStorage key registry | 2h | A-4 | None |
| P1 | Unify draft autosave systems — extract shared logic from `useDraftAutosave` + `useDraftManager` | 4h | A-5, I-2 | None |
| P1 | Create shared error → toast → Sentry pipeline | 3h | A-3 | None |
| P1 | Move `MeScreenHelpers` components (StatCard, SettingRow) to `shared/components/` | 1h | I-8 | None |
| P2 | Add `isFirestoreConnected` fast-fail before cloud operations | 2h | Bug 4.1 | None |
| P2 | Update CSP in `vercel.json` for reCAPTCHA (if App Check desired) | 1h | Bug 5.4 | None |
| P2 | Move `AchievementReset` logic to a shared hook/service | 1h | I-4 | None |
| P2 | Fix `SessionService.getAllSessions` — return error indicator instead of empty array | 1h | Bug 3.3 | None |
| P2 | Fix `SyncService.syncPending` — show user notification on failure | 1h | Bug 3.4 | None |

**Total estimate:** 23h / 36h (64% load)

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| EncryptionService extraction is complex | Vault state could break | Test with real encryption flow before/after |
| Unified draft system changes save behavior | Drafts could be lost | Keep backup of old code in branch |

### Definition of Done
- [ ] No `shared/` file imports from `firebase/` or `features/`
- [ ] Cross-feature imports reduced from 69 to <10
- [ ] `npm run ci` passes
- [ ] Encrypt → decrypt roundtrip still works

---

## Sprint 6: Testing & CI Infrastructure

**Dates:** Week 6
**Sprint Goal:** Establish testing foundations for untested modules, improve CI

### Capacity: 36h

### Sprint Backlog
| Priority | Item | Estimate | Source | Dependencies |
|----------|------|----------|--------|--------------|
| P0 | Create centralized Firebase mock module (`src/test/mocks/firebase.ts`) | 3h | Test infra | None |
| P0 | Create custom render utility with providers (`src/test/utils/render.tsx`) | 2h | Test infra | None |
| P0 | Create test data factories (`src/test/factories/`) | 2h | Test infra | None |
| P0 | Test `useBaseWritingSession` hook | 3h | P0 test gap | Test infra |
| P0 | Test `useSessionFlow` hook | 2h | P0 test gap | Test infra |
| P0 | Test `SessionDeleteService` | 2h | P0 test gap | Firebase mock |
| P1 | Test `WritingSessionService` | 2h | P0 test gap | Firebase mock |
| P1 | Test `WritingDraftService` | 2h | P0 test gap | Firebase mock |
| P1 | Test `AuthContext` (auth state management) | 3h | P0 test gap | Firebase mock |
| P1 | Test `ProtectedRoute` | 1h | P1 test gap | Custom render |
| P1 | Test `ErrorBoundary` | 1h | P1 test gap | None |
| P2 | Test `firestoreSchemas.ts` (Zod validation) | 1h | P1 test gap | None |
| P2 | Test `dateUtils.ts` | 1h | P1 test gap | None |
| P2 | Add coverage config to `vite.config.ts` (thresholds: 70% stmt, 60% branch) | 1h | P4 infra | None |
| P2 | Add `npm run build` to CI workflow | 0.5h | CI | None |
| P2 | Improve `setup.ts` — add IntersectionObserver, ResizeObserver mocks | 1h | P4 infra | None |

**Total estimate:** 27.5h / 36h (76% load)

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Hook testing is tricky with async state | Flaky tests | Use `renderHook` + `act` + fake timers consistently |
| Coverage thresholds may initially fail | CI breaks | Set thresholds at current level, increase incrementally |

### Definition of Done
- [ ] All P0 test gaps covered
- [ ] Coverage >50% on services and hooks
- [ ] CI runs typecheck + lint + test + build
- [ ] `npm run ci` passes

---

## Cross-Sprint Dependency Map

```
Sprint 1 (Security/Crashes)
    ↓
Sprint 2 (Architecture — services extract)  ← depends on Sprint 1 AuthService
    ↓
Sprint 3 (Performance)                       ← depends on Sprint 2 useProfileStats
    ↓
Sprint 4 (Type Safety)                       ← depends on Sprint 2 createdAt type fix
    ↓
Sprint 5 (Abstractions/Coupling)             ← depends on Sprint 1+2 service locations
    ↓
Sprint 6 (Testing)                            ← depends on Sprint 4 (no `as any` to mock)
```

## Overall Metrics

| Metric | Value |
|--------|-------|
| Total sprints | 6 |
| Total duration | 6 weeks |
| Total estimated hours | ~142h |
| Critical items resolved | 6/6 (Sprint 1-2) |
| High items resolved | 10/10 (Sprint 1-3) |
| Medium items resolved | 13/13 (Sprint 3-5) |
| Test coverage target | >50% services/hooks, >70% shared utils |
| `as any` in production | 0 (after Sprint 4) |
| Cross-feature imports | <10 (after Sprint 5, from 69) |

## Stretch Items (if capacity allows)

- Add Playwright with 2-3 basic E2E smoke tests
- Migrate inline styles to Tailwind in mobile components
- Add `eslint-plugin-import` `no-cycle` rule to prevent future coupling
- Clean up `useGuestWritingSession` `useEffect` with no deps
- Fix `discardDraft` async return type mismatch
