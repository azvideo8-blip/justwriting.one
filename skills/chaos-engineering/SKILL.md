---
name: chaos-engineering
description: Analyzes system resilience under failure — dependency failures, degraded modes, recovery behavior, and fault-injection planning. Use when assessing how a system behaves when dependencies fail, when planning resilience improvements, or when designing fault-injection experiments with explicit guardrails.
---

# Chaos Engineering

> Adapted from the [Codex chaos-engineer subagent](https://github.com/VoltAgent/awesome-codex-subagents).

## Overview

Chaos engineering is evidence-driven resilience analysis: map failure surfaces, define hypotheses, validate recovery behavior, and recommend the minimal intervention with highest risk reduction. This is not checklist theater — every finding ties to concrete user-visible failure risk.

## When to Use

- A system component is being changed and you need to understand failure impact
- You suspect degraded-mode behavior under dependency failure
- Retry, timeout, or fallback logic needs validation
- Planning a controlled fault-injection experiment
- After an incident to validate that recovery mechanisms work

**When NOT to use:**

- Pure functional correctness testing — use `test-driven-development`
- Security vulnerability assessment — use `security-and-hardening`
- Performance profiling without failure scenarios — use `performance-optimization`
- Production fault injection without explicit guardrails and approval

## The Process

### Step 1: Map the Failure Surface

Identify the changed or affected behavior boundary and likely failure modes:

```
TARGET SCOPE:
<feature, component, or diff area>

DEPENDENCIES:
- Internal services, databases, caches
- External APIs, third-party integrations
- Infrastructure (network, storage, compute)

FAILURE MODES:
- Dependency unavailable (down, timeout, slow)
- Degraded responses (errors, partial data, stale data)
- Resource exhaustion (memory, CPU, connections, disk)
- Network partition or latency spikes
- Crash / restart / recovery cycles
```

### Step 2: Define Failure Hypotheses

For each failure mode, define a testable hypothesis:

```
HYPOTHESIS: When [dependency] fails with [failure mode],
  the system [expected behavior].
BLAST RADIUS: [what users/features are affected]
SIGNAL: [what metric or log confirms the behavior]
```

### Step 3: Identify Steady-State Signals

Select the metrics and logs that determine whether the service health regresses during the experiment:

```
HEALTH SIGNALS:
- Error rate (target: < X%)
- Latency p95/p99 (target: < Yms)
- Throughput (target: > Z req/s)
- Business-specific (checkout completion, login success, etc.)
```

### Step 4: Design the Minimal Intervention

Recommend the smallest change with highest risk reduction:

```
FINDING: <what was found>
EVIDENCE: <how you know>
RECOMMENDATION: <smallest fix/mitigation>
RISK REDUCTION: <what this protects against>
```

### Step 5: Validate Paths

Validate one normal path, one failure path, and one integration edge:

- **Normal path**: verify baseline behavior works
- **Failure path**: inject the failure, observe degradation behavior
- **Integration edge**: verify boundary behavior (timeout cascading, retry budgets, circuit breaker state)

## Quality Checks

- Every proposed experiment must have explicit hypothesis, scope, and stop criteria
- Safety controls must prevent uncontrolled customer impact
- Expected and unexpected outcomes should both map to actionable next steps
- Reliability metrics must be defined before fault injection planning
- Call out live-environment prerequisites and approvals needed for execution

## Output

```
SCOPE ANALYZED:
<feature path, component, or diff area>

KEY FINDING(S):
<risk hypothesis or defect with supporting evidence>

SMALLEST RECOMMENDED FIX:
<intervention and expected risk reduction>

VALIDATION STATUS:
- Normal path: <status>
- Failure path: <status>
- Integration edge: <status>

RESIDUAL RISK:
<what remains unaddressed and priority>
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The system handles it because there's a try/catch" | Catching an error is not handling it — validate that the fallback actually works |
| "We don't need experiments, we have monitoring" | Monitoring detects symptoms; experiments validate specific failure hypotheses before they happen |
| "Resilience is too expensive to test properly" | A single unvalidated failure path in production costs more than 20 experiments |
| "Our dependencies are reliable enough" | Reliability is a probability, not a binary — plan for the tail |

## Red Flags

- Recommending production fault injection without explicit guardrails
- Proposing experiments without clear stop criteria
- Testing only happy-path resilience (e.g., success after 1 retry, not cascading failure)
- Validating timeouts without considering retry-storm amplification
- Ignoring recovery behavior after the fault is removed

## Interaction with Other Skills

- **`debugging-and-error-recovery`**: use chaos engineering to validate that fixes actually survive real failure modes
- **`security-and-hardening`**: chaos engineering covers operational resilience; security hardening covers adversarial resilience
- **`performance-optimization`**: performance profiling under failure conditions overlaps with chaos engineering's degraded-mode analysis
- **`incident-response`**: post-incident, chaos engineering validates that the fix prevents recurrence

## Verification

- [ ] Failure surface mapped (dependencies, failure modes, blast radius)
- [ ] At least one failure hypothesis defined with expected behavior and signal
- [ ] Steady-state health signals identified and baselined
- [ ] Minimal recommended intervention with evidence and risk reduction estimate
- [ ] One normal path, one failure path, and one integration edge validated
- [ ] Safety guardrails defined for any production experiment proposal
- [ ] Residual risk and follow-up actions documented
