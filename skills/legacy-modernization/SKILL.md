---
name: legacy-modernization
description: Plans and executes incremental modernization of legacy code, frameworks, and architecture — without big-bang rewrites. Use when working with outdated dependencies, deprecated APIs, or brittle architecture. Use when you need a safe migration path that preserves behavior and delivery cadence.
---

# Legacy Modernization

> Adapted from the [Codex legacy-modernizer subagent](https://github.com/VoltAgent/awesome-codex-subagents).

## Overview

Legacy modernization is developer productivity and workflow reliability engineering — not checklist execution. The goal is the smallest practical change that reduces friction, preserves behavioral safety, and improves day-to-day delivery speed. Big-bang rewrites are not the default path.

## When to Use

- Codebase uses an unsupported or end-of-life dependency
- Architectural patterns are blocking new feature development
- Test and deploy cycles are slow due to legacy tooling
- You need to migrate from one framework, library, or pattern to another
- A component is too costly to change safely due to coupling and test gaps
- Onboarding new developers takes weeks due to legacy complexity

**When NOT to use:**

- The code works fine and modernization would provide no tangible improvement
- The system is scheduled for full replacement — invest in maintenance only
- Pure deprecation or removal — use `deprecation-and-migration`
- You need a greenfield design without legacy constraints — use `architecture`

## The Process

### Step 1: Map the Workflow and Pain Points

```
TARGET SYSTEM:
<specific component, service, or module>

CONCRETE PAIN POINTS:
1. Build takes 8+ minutes due to old bundler
2. Test suite requires 3 database connections per test
3. Deploy requires manual SSH to production
4. Every change touches 5 files for what should be a one-line fix
```

Distinguish evidence-backed root causes from symptoms. Slow builds are a symptom; the root cause may be a legacy bundler version that doesn't support incremental compilation.

### Step 2: Assess Legacy Risk

```
RISK                         | SEVERITY
Unsupported dependency       | Critical
No automated tests           | High
Brittle architecture seam    | High
No rollback plan             | Critical
Knowledge loss (1 person)    | Medium
```

### Step 3: Choose the Migration Pattern

| Pattern | When to Use | Key Property |
|---------|-------------|-------------|
| **Strangler Fig** | Replace a bounded component incrementally while routing around it | Reversible at every step |
| **Adapter** | Wrap a legacy interface to match a new contract without changing the legacy code | Minimal change to legacy code |
| **Parallel Run** | Run old and new implementations simultaneously, compare outputs | Zero-risk validation |
| **Feature Flag** | Toggle between old and new behavior per user or request | Granular rollout and rollback |
| **Repository Pattern** | Abstract data access behind an interface; swap implementations | Testability decoupling |

### Step 4: Sequence Modernization Candidates

Prioritize by cost/benefit:

```
CANDIDATE                     | COST | BENEFIT | ORDER
Replace old bundler with Vite | Low  | Build: 8min→10s | 1
Add integration tests         | Med  | Safety: can refactor with confidence | 2
Extract payment module        | High | Impact: reduces deploy risk | 3
```

### Step 5: Define Coexistence and Rollback

For each phase, define:

```
COEXISTENCE PLAN:
- Old and new code run side by side for 2 weeks
- New code behind feature flag, default off
- Logging on both paths for comparison

ROLLBACK TRIGGERS:
- Error rate > 0.1% on new path
- Latency p95 > 2x old path
- Any data inconsistency detected
```

## Quality Checks

- Modernization recommendations are phased and reversible
- Behavior-preservation strategy is defined for critical business paths
- Dependency and runtime constraints that can derail migration are checked
- Transitional architecture does not create unbounded complexity
- Proof-of-concept validations are identified before broad rollout

## Output

```
SCOPE:
<component, service, or module under analysis>

PRIMARY FRICTION SOURCE:
<root cause with supporting evidence>

SMALLEST SAFE CHANGE:
<recommendation and key tradeoffs>

MIGRATION PLAN:
| Phase | Change | Pattern | Coexistence | Rollback |
|-------|--------|---------|-------------|----------|

VALIDATIONS PERFORMED:
<what was verified>

RESIDUAL RISK:
<what remains and follow-up actions>
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "Let's just rewrite it from scratch" | Big-bang rewrites fail at alarming rates. The strangler fig pattern delivers value incrementally while preserving the option to stop. |
| "We can modernize without tests" | Without tests, you can't tell if you changed behavior. Invest in safety nets first. |
| "Modernization means using the newest version of everything" | The best version is the one that solves your specific pain point, not the latest. Upgrade with purpose. |
| "We'll fix the architecture once we finish the features" | Architecture debt compounds. Each feature built on a brittle foundation makes future modernization harder. |
| "The legacy system is stable, don't touch it" | Stability in a legacy system often means "nobody understands it enough to break it." That's not stability — it's risk. |

## Red Flags

- Proposing a big-bang rewrite as the default path
- No behavior-preservation strategy for critical business paths
- Migrating to a new version without checking for breaking changes in dependencies
- Replacing a legacy system without understanding all integrations and side effects
- No rollback plan for any phase
- Modernization creates a "temporary" transitional architecture that persists for years
- Upgrading dependencies without a way to validate that downstream consumers still work

## Interaction with Other Skills

- **`deprecation-and-migration`**: use this skill for removal of old systems; legacy-modernization focuses on *transforming* existing systems
- **`code-mapping`**: use code-mapping first to understand the full surface area before planning modernization
- **`test-driven-development`**: build test safety nets around legacy code before refactoring
- **`incremental-implementation`**: each phase of modernization should be delivered incrementally
- **`code-simplification`**: after migration, simplify the modernized code that may carry over legacy patterns
- **`debugging-and-error-recovery`**: legacy systems produce unusual errors — use systematic debugging when behavior differs after migration

## Verification

- [ ] Target system and concrete pain points documented
- [ ] Legacy risk assessed across dependencies, tests, architecture, and knowledge retention
- [ ] Migration pattern selected (strangler fig, adapter, parallel run, feature flag, or repository)
- [ ] Modernization candidates sequenced by cost/benefit
- [ ] Coexistence plan defined for each phase
- [ ] Rollback triggers and plan documented
- [ ] Test safety net exists or is planned before refactoring
- [ ] Proof-of-concept validations identified before broad rollout
- [ ] No big-bang rewrite as default path
