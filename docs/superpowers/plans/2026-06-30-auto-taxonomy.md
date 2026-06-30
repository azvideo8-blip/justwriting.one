# Personal Auto-Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `LIFE_DOMAINS` facet taxonomy with a per-user taxonomy derived by an LLM from the user's own note summaries, with a cold-start fallback and a label-preserving re-derive.

**Architecture:** A new limit-exempt server callable `deriveTaxonomy` turns a compact digest of `aiSummaries` into 6–10 `{label, seed}` domains. A client `AITaxonomyService` stores the taxonomy in `localStorage`, exposes `getActive()` (the single seam `AIProfileFacetService.build()` reads instead of `LIFE_DOMAINS`), bootstraps it in the background indexer, and re-derives on demand while carrying labels forward. Downstream facet logic (thresholds, primary/secondary, PROF-8, discovered clusters, summaries) is unchanged.

**Tech Stack:** TypeScript, React, Vite, Vitest (src tests), Firebase Cloud Functions v2 (onCall), Fireworks (gpt-oss-20b via the existing `generate()` provider), `idb` IndexedDB wrapper (read-only here), `localStorage`.

## Global Constraints

- `deriveTaxonomy` is **infra**, exempt from per-user limits — guard with `tryReserveGlobalRequest()` only (never `checkDailyLimit`/`checkRateLimit`). Verbatim pattern from `functions/src/ai/summarizeFacet.ts`.
- Model for the callable: `process.env.AI_FACET_MODEL ?? 'accounts/fireworks/models/gpt-oss-20b'`. gpt-oss is a reasoning model — use adequate `maxTokens` (≥4096) and salvage truncated output (reuse the `repairTruncatedJson` approach from `summarizeDocument.ts`). Never `reasoning_effort: 'low'` (returns near-empty output).
- Taxonomy storage is **`localStorage` only** — do NOT add an IndexedDB store (a schema bump risks stale-PWA breakage; see `sw-indexeddb-staleness`).
- Domain count target: 6–10. Default threshold for derived domains: `0.47`.
- `BOOTSTRAP_MIN = 20` summarized notes; `REDERIVE_DELTA = 40` notes.
- All anti-confabulation rules from the facet-summary prompt apply to `deriveTaxonomy`: use only what's in the digest; no invented names/facts.
- Commit after each task. Do NOT push or deploy — the human gates that.
- v1 is fully automatic, read-only for the end user. No user editing, no cloud sync.

**Reference signatures (existing code, do not change):**
- `LifeDomain` (`src/features/ai/utils/lifeDomains.ts`): `{ id: string; label: string; seed: string; threshold?: number }`. `LIFE_DOMAINS: LifeDomain[]`.
- `AIService.embed({ content })` → `{ ok: true; vectors: number[][]; dim; model } | { ok: false; error }`.
- `cosineSimilarity(a: number[], b: number[]): number` (`src/features/ai/utils/vectorSearch.ts`).
- `aiSummaries` record (`src/core/storage/localDb.ts`): `{ documentId: string; themes: string[]; insights: string[]; mentionedPeople?: { name: string; role: string }[]; ... }`. Read via `(await getLocalDb()).getAll('aiSummaries')`.
- `domainSeeds.ts` exports `getDomainSeedVectors(): Promise<DomainSeedVec[]>`, `__resetDomainSeedCache()`, `DomainSeedVec = { id; label; vec: number[]; threshold }`.

---

### Task 1: Taxonomy types + localStorage store + cold-start `getActive`

**Files:**
- Create: `src/features/ai/services/AITaxonomyService.ts`
- Test: `src/features/ai/services/__tests__/AITaxonomyService.test.ts`

**Interfaces:**
- Consumes: `LifeDomain`, `LIFE_DOMAINS` from `../utils/lifeDomains`.
- Produces:
  - `interface TaxonomyDomain extends LifeDomain { derivedAt: number; noteCountAtDerive: number; source: 'default' | 'derived'; origin?: 'bootstrap' | 'rederive' }`
  - `AITaxonomyService.getActive(): Promise<LifeDomain[]>`
  - `AITaxonomyService.getStored(): TaxonomyDomain[] | null`
  - `AITaxonomyService.save(domains: TaxonomyDomain[]): void`
  - `AITaxonomyService.clear(): void`
  - `const TAXONOMY_LS_KEY = 'ai_taxonomy'`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/ai/services/__tests__/AITaxonomyService.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AITaxonomyService, type TaxonomyDomain } from '../AITaxonomyService';
import { LIFE_DOMAINS } from '../../utils/lifeDomains';

const sample: TaxonomyDomain = {
  id: 'd_calling', label: 'Призвание', seed: 'смысл и призвание, кем быть',
  threshold: 0.47, derivedAt: 1, noteCountAtDerive: 40, source: 'derived', origin: 'bootstrap',
};

describe('AITaxonomyService storage', () => {
  beforeEach(() => localStorage.clear());

  it('getStored returns null when nothing saved', () => {
    expect(AITaxonomyService.getStored()).toBeNull();
  });

  it('save then getStored round-trips', () => {
    AITaxonomyService.save([sample]);
    expect(AITaxonomyService.getStored()).toEqual([sample]);
  });

  it('getActive falls back to LIFE_DOMAINS when no taxonomy stored', async () => {
    const active = await AITaxonomyService.getActive();
    expect(active).toEqual(LIFE_DOMAINS);
  });

  it('getActive returns stored domains (as LifeDomain) when present', async () => {
    AITaxonomyService.save([sample]);
    const active = await AITaxonomyService.getActive();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: 'd_calling', label: 'Призвание', seed: sample.seed, threshold: 0.47 });
  });

  it('clear removes the taxonomy', () => {
    AITaxonomyService.save([sample]);
    AITaxonomyService.clear();
    expect(AITaxonomyService.getStored()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/ai/services/__tests__/AITaxonomyService.test.ts`
Expected: FAIL — `Cannot find module '../AITaxonomyService'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/ai/services/AITaxonomyService.ts
import { LIFE_DOMAINS, type LifeDomain } from '../utils/lifeDomains';

export const TAXONOMY_LS_KEY = 'ai_taxonomy';
export const DERIVED_DEFAULT_THRESHOLD = 0.47;

export interface TaxonomyDomain extends LifeDomain {
  derivedAt: number;
  noteCountAtDerive: number;
  source: 'default' | 'derived';
  origin?: 'bootstrap' | 'rederive';
}

interface StoredTaxonomy { version: 1; domains: TaxonomyDomain[] }

export const AITaxonomyService = {
  getStored(): TaxonomyDomain[] | null {
    const raw = localStorage.getItem(TAXONOMY_LS_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredTaxonomy;
      return Array.isArray(parsed.domains) && parsed.domains.length > 0 ? parsed.domains : null;
    } catch {
      return null;
    }
  },

  save(domains: TaxonomyDomain[]): void {
    const payload: StoredTaxonomy = { version: 1, domains };
    localStorage.setItem(TAXONOMY_LS_KEY, JSON.stringify(payload));
  },

  clear(): void {
    localStorage.removeItem(TAXONOMY_LS_KEY);
  },

  // The single seam build() reads. Stored taxonomy if present, else the
  // hardcoded universal defaults (cold-start).
  async getActive(): Promise<LifeDomain[]> {
    const stored = this.getStored();
    if (!stored) return LIFE_DOMAINS;
    return stored.map(d => ({ id: d.id, label: d.label, seed: d.seed, threshold: d.threshold }));
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/ai/services/__tests__/AITaxonomyService.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/ai/services/AITaxonomyService.ts src/features/ai/services/__tests__/AITaxonomyService.test.ts
git commit -m "feat(ai): taxonomy store + cold-start getActive"
```

---

### Task 2: Summary digest builder

**Files:**
- Modify: `src/features/ai/services/AITaxonomyService.ts`
- Test: `src/features/ai/services/__tests__/AITaxonomyService.test.ts`

**Interfaces:**
- Consumes: `aiSummaries` record shape (themes/insights/mentionedPeople).
- Produces: `buildSummaryDigest(summaries: SummaryLike[], maxNotes?: number): string` and `interface SummaryLike { themes?: string[]; insights?: string[]; mentionedPeople?: { name: string; role: string }[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// add to AITaxonomyService.test.ts
import { buildSummaryDigest } from '../AITaxonomyService';

describe('buildSummaryDigest', () => {
  it('compacts each summary to themes/insights/people lines', () => {
    const digest = buildSummaryDigest([
      { themes: ['деньги', 'работа'], insights: ['Тревога из-за дохода'], mentionedPeople: [{ name: 'Саша', role: 'жена' }] },
    ]);
    expect(digest).toContain('деньги');
    expect(digest).toContain('Тревога из-за дохода');
    expect(digest).toContain('Саша');
  });

  it('caps the number of notes included', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ themes: [`t${i}`], insights: [], mentionedPeople: [] }));
    const digest = buildSummaryDigest(many, 200);
    expect(digest.split('\n---\n').length).toBeLessThanOrEqual(200);
  });

  it('skips empty summaries', () => {
    const digest = buildSummaryDigest([{ themes: [], insights: [], mentionedPeople: [] }]);
    expect(digest).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/ai/services/__tests__/AITaxonomyService.test.ts -t buildSummaryDigest`
Expected: FAIL — `buildSummaryDigest` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to AITaxonomyService.ts (top-level export)
export interface SummaryLike {
  themes?: string[];
  insights?: string[];
  mentionedPeople?: { name: string; role: string }[];
}

export function buildSummaryDigest(summaries: SummaryLike[], maxNotes = 200): string {
  const blocks: string[] = [];
  for (const s of summaries.slice(0, maxNotes)) {
    const themes = (s.themes ?? []).filter(Boolean);
    const insights = (s.insights ?? []).filter(Boolean);
    const people = (s.mentionedPeople ?? []).map(p => `${p.name} (${p.role})`).filter(Boolean);
    if (themes.length === 0 && insights.length === 0 && people.length === 0) continue;
    const parts: string[] = [];
    if (themes.length) parts.push(`Темы: ${themes.join(', ')}`);
    if (insights.length) parts.push(`Инсайты: ${insights.join('; ')}`);
    if (people.length) parts.push(`Люди: ${people.join(', ')}`);
    blocks.push(parts.join('\n'));
  }
  return blocks.join('\n---\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/ai/services/__tests__/AITaxonomyService.test.ts -t buildSummaryDigest`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/ai/services/AITaxonomyService.ts src/features/ai/services/__tests__/AITaxonomyService.test.ts
git commit -m "feat(ai): summary digest builder for taxonomy derivation"
```

---

### Task 3: `deriveTaxonomy` server callable + client wrapper

**Files:**
- Create: `functions/src/ai/deriveTaxonomy.ts`
- Modify: `functions/src/index.ts` (add export line)
- Modify: `src/features/ai/services/AIService.ts` (add `deriveTaxonomy` wrapper)

**Interfaces:**
- Consumes (server): `generate`, `tryReserveGlobalRequest`, `refundGlobalRequest`, `sanitizeAiInput`, `sanitizeAiResponse`, `INJECTION_PATTERNS` from `../shared/*`.
- Produces:
  - Callable `deriveTaxonomy(data: { digest: string }) → { domains: { label: string; seed: string }[] }`.
  - Client `AIService.deriveTaxonomy(params: { digest: string }): Promise<{ ok: true; domains: { label: string; seed: string }[] } | { ok: false; error: string }>`.

Note: no automated test harness exists for `functions/` (its tests are a separate emulator stand). Validate this task by `npm --prefix functions run build` (tsc) and a live Fireworks check during implementation (see Step 4). The salvage + zod parse are copied verbatim from the proven `summarizeDocument.ts`/`summarizeFacet.ts`.

- [ ] **Step 1: Write the callable**

```ts
// functions/src/ai/deriveTaxonomy.ts
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { sanitizeAiInput, sanitizeAiResponse, recordUsage, tryReserveGlobalRequest, refundGlobalRequest, INJECTION_PATTERNS } from '../shared/aiUtils';
import { generate } from '../shared/aiProvider';

const inputSchema = z.object({ digest: z.string().min(20).max(60_000) });

const TAXO_MODEL = process.env.AI_FACET_MODEL ?? 'accounts/fireworks/models/gpt-oss-20b';

const SYSTEM_PROMPT = `Ты получаешь дайджест тем, инсайтов и людей из личного дневника одного человека. Определи 6–10 ОСНОВНЫХ жизненных сфер (доменов), вокруг которых вращается этот дневник — так, как они есть у ЭТОГО человека, а не общими категориями. Верни СТРОГО валидный JSON:
{"domains":[{"label":"короткое название сферы, 1–3 слова","seed":"1–2 предложения, богато описывающие эту сферу словами из дайджеста — для семантического поиска"}]}
ЖЁСТКИЕ ПРАВИЛА: опирайся ТОЛЬКО на дайджест; не выдумывай сфер, которых в нём нет; имена и факты бери из дайджеста буквально; 6–10 доменов, не больше; только JSON, без markdown и рассуждений.`;

function repairTruncatedJson(raw: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const c of raw) {
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  let out = raw;
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}

const domainSchema = z.object({ label: z.string().min(1).max(60), seed: z.string().min(3).max(600) });

export const deriveTaxonomy = onCall({
  secrets: ['GEMINI_API_KEY', 'FIREWORKS_API_KEY'],
  timeoutSeconds: 120,
  enforceAppCheck: false,
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Registration required.');
  const uid = request.auth.uid;

  const parsed = inputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid payload.');

  const digest = sanitizeAiInput(parsed.data.digest);
  if (INJECTION_PATTERNS.some(p => p.test(digest))) {
    throw new HttpsError('invalid-argument', 'Disallowed patterns in digest.');
  }

  if (!(await tryReserveGlobalRequest())) {
    throw new HttpsError('resource-exhausted', 'Free-tier daily limit reached for the whole app. Try again tomorrow.');
  }

  try {
    const result = await generate({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Дайджест дневника:\n\n${digest}` }],
      json: true,
      maxTokens: 4096,
      abortMs: 110_000,
      model: TAXO_MODEL,
    });
    recordUsage(uid, result.tokensIn, result.tokensOut, { model: result.model, fn: 'taxonomy' }).catch(() => {});

    let txt = result.text.trim();
    if (txt.startsWith('```')) txt = txt.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    let obj: unknown;
    try { obj = JSON.parse(txt); } catch { obj = JSON.parse(repairTruncatedJson(txt)); }

    const arr = z.object({ domains: z.array(domainSchema) }).safeParse(obj);
    if (!arr.success || arr.data.domains.length === 0) {
      throw new HttpsError('internal', 'Taxonomy derivation produced no domains.');
    }
    const domains = arr.data.domains.slice(0, 10).map(d => ({
      label: sanitizeAiResponse(d.label),
      seed: sanitizeAiResponse(d.seed),
    })).filter(d => d.label.length > 0 && d.seed.length > 0);

    return { domains };
  } catch (e) {
    await refundGlobalRequest();
    const msg = String((e as { message?: string })?.message ?? e);
    if (/spending cap|quota|RESOURCE_EXHAUSTED|exceeded/i.test(msg)) {
      throw new HttpsError('resource-exhausted', 'AI service temporarily unavailable.');
    }
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', 'Taxonomy derivation failed.');
  }
});
```

- [ ] **Step 2: Export it**

```ts
// functions/src/index.ts — add next to the existing summarizeFacet export
export { deriveTaxonomy } from './ai/deriveTaxonomy';
```

- [ ] **Step 3: Add the client wrapper**

```ts
// src/features/ai/services/AIService.ts — add a method mirroring summarizeFacet
async deriveTaxonomy(params: { digest: string }): Promise<
  { ok: true; domains: { label: string; seed: string }[] } | { ok: false; error: string }
> {
  try {
    const fn = httpsCallable<unknown, { domains: { label: string; seed: string }[] }>(functions, 'deriveTaxonomy');
    const res = await fn(params);
    return { ok: true, domains: res.data.domains ?? [] };
  } catch (e) {
    reportError(e, { action: 'deriveTaxonomy' });
    return { ok: false, error: String((e as { code?: string })?.code ?? 'error') };
  }
},
```

- [ ] **Step 4: Build + live check**

Run: `npm --prefix functions run build`
Expected: tsc exits 0.

Live check (one-off, key from `~/.zshrc`, never print it): POST a small synthetic digest to the Fireworks `chat/completions` with `model=gpt-oss-20b`, `response_format=json_object`, `max_tokens=4096`, the `SYSTEM_PROMPT` above; confirm the response parses to `{domains:[…]}` with 6–10 items and `finish_reason=stop`. (This mirrors the validation done for the truncation fix.)

- [ ] **Step 5: Commit**

```bash
git add functions/src/ai/deriveTaxonomy.ts functions/src/index.ts src/features/ai/services/AIService.ts
git commit -m "feat(ai): deriveTaxonomy callable + client wrapper"
```

---

### Task 4: Generalize seed embedding to an arbitrary domain list

**Files:**
- Modify: `src/features/ai/utils/domainSeeds.ts`
- Test: `src/features/ai/utils/__tests__/domainSeeds.test.ts`

**Interfaces:**
- Consumes: `LifeDomain`, existing `DomainSeedVec`, `AIService.embed`.
- Produces: `getSeedVectors(domains: LifeDomain[]): Promise<DomainSeedVec[]>`. Keep `getDomainSeedVectors()` as a thin wrapper = `getSeedVectors(LIFE_DOMAINS)` so `FacetDiagnostics` is unaffected.

- [ ] **Step 1: Write the failing test**

```ts
// add to src/features/ai/utils/__tests__/domainSeeds.test.ts
import { getSeedVectors } from '../domainSeeds';

describe('getSeedVectors (arbitrary list)', () => {
  beforeEach(() => { __resetDomainSeedCache(); embedMock.mockReset(); });

  it('embeds each provided domain once and carries its threshold', async () => {
    embedMock.mockResolvedValue(okVec());
    const vecs = await getSeedVectors([
      { id: 'x', label: 'X', seed: 'sx', threshold: 0.5 },
      { id: 'y', label: 'Y', seed: 'sy' },
    ]);
    expect(vecs.map(v => v.id)).toEqual(['x', 'y']);
    expect(vecs[0]!.threshold).toBe(0.5);
    expect(vecs[1]!.threshold).toBe(0.45); // default
    expect(embedMock).toHaveBeenCalledTimes(2);
  });
});
```

(Reuse the file's existing `embedMock`, `okVec`, `__resetDomainSeedCache` helpers.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/ai/utils/__tests__/domainSeeds.test.ts -t "arbitrary list"`
Expected: FAIL — `getSeedVectors` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// domainSeeds.ts — generalize. Cache key now includes a hash of the domain list.
import { LIFE_DOMAINS, type LifeDomain } from './lifeDomains';
// ...existing imports (AIService, CURRENT_EMBED_MODEL, CURRENT_EMBED_DIM)...

function listKey(domains: LifeDomain[]): string {
  return domains.map(d => `${d.id}:${d.seed.length}`).join('|');
}

export async function getSeedVectors(domains: LifeDomain[]): Promise<DomainSeedVec[]> {
  const cacheKey = `${CURRENT_EMBED_MODEL}:${CURRENT_EMBED_DIM}:${listKey(domains)}`;
  if (domainSeedCache && domainSeedCache.key === cacheKey) return domainSeedCache.vecs;
  const vecs: DomainSeedVec[] = [];
  for (const d of domains) {
    const res = await AIService.embed({ content: d.seed });
    if (!res.ok || !res.vectors[0]) continue;
    vecs.push({ id: d.id, label: d.label, vec: res.vectors[0], threshold: d.threshold ?? DEFAULT_DOMAIN_THRESHOLD });
  }
  domainSeedCache = { key: cacheKey, vecs };
  return vecs;
}

export async function getDomainSeedVectors(): Promise<DomainSeedVec[]> {
  return getSeedVectors(LIFE_DOMAINS);
}
```

(Update the `CachedSeeds`/`domainSeedCache` key type to `string` — already a string.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/ai/utils/__tests__/domainSeeds.test.ts`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/features/ai/utils/domainSeeds.ts src/features/ai/utils/__tests__/domainSeeds.test.ts
git commit -m "feat(ai): getSeedVectors for arbitrary domain lists"
```

---

### Task 5: `build()` consumes the active taxonomy

**Files:**
- Modify: `src/features/ai/services/AIProfileFacetService.ts` (the seed-embedding loop near the top of `build()` and the threshold lookup)

**Interfaces:**
- Consumes: `AITaxonomyService.getActive()`, `LifeDomain`.

- [ ] **Step 1: Replace the hardcoded domain source**

In `build()`, replace the `LIFE_DOMAINS` seed-embed loop:

```ts
// BEFORE
const domainVecs: { id: string; label: string; vec: number[] }[] = [];
for (const d of LIFE_DOMAINS) {
  const res = await AIService.embed({ content: d.seed });
  if (res.ok && res.vectors[0]) domainVecs.push({ id: d.id, label: d.label, vec: res.vectors[0] });
}
```

```ts
// AFTER
const taxonomy = await AITaxonomyService.getActive();
const domainVecs: { id: string; label: string; vec: number[] }[] = [];
for (const d of taxonomy) {
  const res = await AIService.embed({ content: d.seed });
  if (res.ok && res.vectors[0]) domainVecs.push({ id: d.id, label: d.label, vec: res.vectors[0] });
}
```

Replace the threshold lookup later in the same function:

```ts
// BEFORE
threshold: LIFE_DOMAINS.find(ld => ld.id === d.id)?.threshold ?? DOMAIN_THRESHOLD,
// AFTER
threshold: taxonomy.find(ld => ld.id === d.id)?.threshold ?? DOMAIN_THRESHOLD,
```

Add the import: `import { AITaxonomyService } from './AITaxonomyService';`. Remove the now-unused `LIFE_DOMAINS` import **only if** no other reference remains (search the file first; keep it if still used).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Verify existing facet tests still pass**

Run: `npx vitest run src/features/ai/`
Expected: PASS (no regressions; getActive returns `LIFE_DOMAINS` by default so behavior is unchanged when no taxonomy is stored).

- [ ] **Step 4: Commit**

```bash
git add src/features/ai/services/AIProfileFacetService.ts
git commit -m "feat(ai): build() reads active taxonomy instead of hardcoded LIFE_DOMAINS"
```

---

### Task 6: `ensureBootstrap` + `rederive` with label continuity

**Files:**
- Modify: `src/features/ai/services/AITaxonomyService.ts`
- Test: `src/features/ai/services/__tests__/AITaxonomyService.test.ts`

**Interfaces:**
- Consumes: `getLocalDb`, `AIService.deriveTaxonomy`, `cosineSimilarity`, `getSeedVectors` (Task 4), `buildSummaryDigest` (Task 2), `BOOTSTRAP_MIN`.
- Produces:
  - `matchLabels(prev: TaxonomyDomain[], next: { label: string; seed: string }[], prevVecs: number[][], nextVecs: number[][], cosine): { label: string; seed: string }[]` — pure, carries a prev label forward when its seed vector matches a next domain above `0.8` cosine.
  - `AITaxonomyService.ensureBootstrap(): Promise<'bootstrapped' | 'skip'>`
  - `AITaxonomyService.rederive(): Promise<'ok' | 'skip'>`
  - `const BOOTSTRAP_MIN = 20`

- [ ] **Step 1: Write the failing test (label continuity — pure)**

```ts
// add to AITaxonomyService.test.ts
import { matchLabels } from '../AITaxonomyService';

describe('matchLabels', () => {
  const cos = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]!; // unit vectors
  it('carries forward the prev label when seed vectors clearly match', () => {
    const prev = [{ id: 'p1', label: 'Призвание', seed: 's', threshold: 0.47, derivedAt: 1, noteCountAtDerive: 1, source: 'derived' as const }];
    const next = [{ label: 'Смысл жизни', seed: 's2' }];
    const out = matchLabels(prev, next, [[1, 0]], [[0.99, 0.01]], cos);
    expect(out[0]!.label).toBe('Призвание'); // carried forward
  });
  it('keeps the new label when nothing matches', () => {
    const prev = [{ id: 'p1', label: 'Призвание', seed: 's', threshold: 0.47, derivedAt: 1, noteCountAtDerive: 1, source: 'derived' as const }];
    const next = [{ label: 'Деньги', seed: 's2' }];
    const out = matchLabels(prev, next, [[1, 0]], [[0, 1]], cos);
    expect(out[0]!.label).toBe('Деньги');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/ai/services/__tests__/AITaxonomyService.test.ts -t matchLabels`
Expected: FAIL — `matchLabels` not exported.

- [ ] **Step 3: Implement matchLabels + ensureBootstrap + rederive**

```ts
// add to AITaxonomyService.ts
import { getLocalDb } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { getSeedVectors } from '../utils/domainSeeds';
import { cosineSimilarity } from '../utils/vectorSearch';

export const BOOTSTRAP_MIN = 20;
const CONTINUITY_COS = 0.8;

export function matchLabels(
  prev: TaxonomyDomain[],
  next: { label: string; seed: string }[],
  prevVecs: number[][],
  nextVecs: number[][],
  cosine: (a: number[], b: number[]) => number = cosineSimilarity,
): { label: string; seed: string }[] {
  return next.map((n, i) => {
    const nv = nextVecs[i];
    if (!nv) return n;
    let best = CONTINUITY_COS, bestLabel: string | null = null;
    for (let j = 0; j < prev.length; j++) {
      const pv = prevVecs[j];
      if (!pv) continue;
      const s = cosine(nv, pv);
      if (s >= best) { best = s; bestLabel = prev[j]!.label; }
    }
    return bestLabel ? { label: bestLabel, seed: n.seed } : n;
  });
}

async function deriveAndStore(origin: 'bootstrap' | 'rederive'): Promise<'ok' | 'skip'> {
  const db = await getLocalDb();
  const summaries = await db.getAll('aiSummaries');
  if (summaries.length < BOOTSTRAP_MIN) return 'skip';
  const digest = buildSummaryDigest(summaries);
  if (!digest) return 'skip';

  const res = await AIService.deriveTaxonomy({ digest });
  if (!res.ok || res.domains.length === 0) return 'skip';
  let domains = res.domains;

  // Label continuity on re-derive.
  const prev = AITaxonomyService.getStored();
  if (origin === 'rederive' && prev && prev.length > 0) {
    const prevVecs = (await getSeedVectors(prev)).map(v => v.vec);
    const nextVecs = (await getSeedVectors(domains.map((d, i) => ({ id: `n${i}`, label: d.label, seed: d.seed })))).map(v => v.vec);
    domains = matchLabels(prev, domains, prevVecs, nextVecs);
  }

  const now = Date.now();
  AITaxonomyService.save(domains.map((d, i) => ({
    id: `tx_${now}_${i}`,
    label: d.label,
    seed: d.seed,
    threshold: DERIVED_DEFAULT_THRESHOLD,
    derivedAt: now,
    noteCountAtDerive: summaries.length,
    source: 'derived',
    origin,
  })));
  return 'ok';
}

// attach to the AITaxonomyService object:
//   async ensureBootstrap() { if (this.getStored()) return 'skip'; return (await deriveAndStore('bootstrap')) === 'ok' ? 'bootstrapped' : 'skip'; },
//   async rederive() { return deriveAndStore('rederive'); },
```

Add the two methods to the `AITaxonomyService` object literal:

```ts
  async ensureBootstrap(): Promise<'bootstrapped' | 'skip'> {
    if (this.getStored()) return 'skip';
    return (await deriveAndStore('bootstrap')) === 'ok' ? 'bootstrapped' : 'skip';
  },
  async rederive(): Promise<'ok' | 'skip'> {
    return deriveAndStore('rederive');
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/ai/services/__tests__/AITaxonomyService.test.ts`
Expected: PASS (all, including matchLabels).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/ai/services/AITaxonomyService.ts src/features/ai/services/__tests__/AITaxonomyService.test.ts
git commit -m "feat(ai): taxonomy bootstrap + re-derive with label continuity"
```

---

### Task 7: Background bootstrap trigger

**Files:**
- Modify: `src/features/ai/hooks/useEmbeddingIndexer.ts`

**Interfaces:**
- Consumes: `AITaxonomyService.ensureBootstrap`.

- [ ] **Step 1: Wire the trigger**

In `runBatch`, after summaries get produced/`resummarizeDirty` is scheduled (near the existing `scheduleResummarize()` / facet incremental block), add a best-effort bootstrap that runs once when enough summaries exist and no taxonomy is stored yet:

```ts
import { AITaxonomyService } from '../services/AITaxonomyService';
// ...inside runBatch, after the indexing loop, before syncPendingToCloud:
void AITaxonomyService.ensureBootstrap().catch(e =>
  reportError(e, { action: '[useEmbeddingIndexer] taxonomy bootstrap failed' }),
);
```

(It is cheap and self-guards: returns `'skip'` immediately when a taxonomy already exists or there are too few summaries — no LLM call in that case because `deriveAndStore` checks the count before calling `deriveTaxonomy`.)

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 3: Verify the indexer hook tests (if any) still pass**

Run: `npx vitest run src/features/ai/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/ai/hooks/useEmbeddingIndexer.ts
git commit -m "feat(ai): bootstrap personal taxonomy in background indexer"
```

---

### Task 8: Real-corpus validation (manual gate)

**Files:** none (verification only).

- [ ] **Step 1: Build + full check**

Run: `npm run typecheck && npm run lint && npx vitest run src/features/ai/ && npm --prefix functions run build`
Expected: all green.

- [ ] **Step 2: Live ground-truth check**

With `deriveTaxonomy` deployed (human gates the deploy) and the author's notes indexed/summarized, clear any stored taxonomy (`AITaxonomyService.clear()` via console), trigger a build, and confirm the derived domains approximate the hand-authored set (Призвание / Творчество / Практика / Деньги / Семья / Внутренняя работа). Record the output in the PR/commit notes. This is the success criterion: automation reproduces the manual taxonomy.

- [ ] **Step 3: No commit** (verification only). Report results to the human for the deploy/version decision.

---

## Deferred to a follow-up plan (v1.1)

- Incremental promotion of a stable discovered-cluster into a named domain (the "grow" arm of the hybrid lifecycle). Core derive + cold-start + manual re-derive ship first; auto-grow is additive.
- Auto re-derive on `REDERIVE_DELTA`. v1 ships bootstrap + a manual `rederive()`; wiring an automatic trigger is a small follow-up once the manual path is proven.

## Self-Review

- **Spec coverage:** deriveTaxonomy (T3) ✓; localStorage store + getActive cold-start (T1) ✓; digest from summaries (T2) ✓; generalized seed embed (T4) ✓; build() seam (T5) ✓; bootstrap + re-derive + label continuity (T6) ✓; background trigger (T7) ✓; real-corpus validation (T8) ✓. Hybrid "incremental grow" and auto re-derive explicitly deferred (spec's non-critical arm) — noted above.
- **Placeholders:** none — every code step has concrete code; live-check steps specify exact params.
- **Type consistency:** `TaxonomyDomain`, `getActive(): Promise<LifeDomain[]>`, `getSeedVectors(domains)`, `matchLabels(...)`, `deriveTaxonomy({digest})→{domains:{label,seed}[]}` are used consistently across T1–T7.
