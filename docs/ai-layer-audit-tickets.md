# AI Layer Audit Tickets — July 2026

Self-contained. Prefix: `AIL-`. Source: deep audit of the full AI pipeline (2026-07-08). Severity: 🔴 Critical / 🟠 High / 🟡 Medium.

---

## AIL-1 — `rerankNotes`: returned document IDs not validated against input candidates 🔴

**Context:** `functions/src/ai/rerankNotes.ts:68–76`

The model's JSON response `{ ids: [...] }` is filtered only for string type, not checked against the actual `candidates` input. The model can hallucinate arbitrary IDs (or return a real ID from a previous session that's no longer in the candidate set). `loadNotes` in `noteRetriever.ts` silently skips missing documents (`if (!doc) continue`), so the caller receives fewer results than expected with no error or log.

```ts
// current — no cross-check:
if (Array.isArray(obj.ids)) ids = obj.ids.filter((x): x is string => typeof x === 'string');
```

**Fix — add one line after the filter:**
```ts
const candidateIds = new Set(candidates.map(c => c.documentId));
ids = ids.filter(id => candidateIds.has(id));
```

**Acceptance:** If the model returns a hallucinated ID not present in `candidates`, it is dropped. The returned `documentIds` array contains only IDs from the original `candidates` list. Add a unit test: mock generate() to return an ID not in candidates, assert it's absent in the response.

---

## AIL-2 — `aiProvider.generateOpenRouter`: `res.json()` called after AbortController timeout is already cleared 🟠

**Context:** `functions/src/shared/aiProvider.ts:83–111`

The request timeout (`AbortController`) is cleared in the `finally` block immediately after `fetch()` returns headers. The response body is then read via `await res.json()` with no timeout protection. If OpenRouter returns headers 200 OK but hangs transmitting the body (network partition, slow upstream), the function blocks until Firebase Functions' hard wall-clock timeout (120 s), wasting a global budget slot.

```ts
} finally {
  clearTimeout(timeout);  // ← fired as soon as headers arrive
}
// no timeout from here:
const data = (await res.json()) as { ... };
```

**Fix:** wrap body read in a `Promise.race` with a new deadline:
```ts
const jsonTimeout = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error('body read timeout')), 30_000)
);
const data = await Promise.race([res.json(), jsonTimeout]) as { ... };
```
30 s is generous — the body for these non-streaming calls is small JSON.

**Acceptance:** A simulated stalled response body causes the function to reject within ~30 s, refund the global slot, and throw `HttpsError('internal', ...)` to the caller. No function hangs past the body-read deadline.

---

## AIL-3 — `getMiniSearch` loads ALL version records for ALL documents on every cache miss 🟠

**Context:** `src/features/ai/utils/noteRetriever.ts:36–63`

```ts
for (const doc of docs) {
  const versions = await db.getAllFromIndex('versions', 'by-document', doc.id);
  // takes only versions[0].content after sort
}
```

For N documents with M versions each, this is N × M IDB reads. With 100 documents × 20 versions = 2 000 record reads, then sorted and discarded — every 5 minutes when the `miniSearchInstance` TTL expires. `LocalVersionService.getLatestContent(docId)` already exists and uses an O(1) reverse cursor on `by-doc-version`.

**Fix:**
```ts
import { LocalVersionService } from '../../../core/services/LocalVersionService';

// replace the inner loop:
for (const doc of docs) {
  const content = await LocalVersionService.getLatestContent(doc.id);
  if (!content) continue;
  entries.push({ id: doc.id, title: doc.title ?? '', content: content.slice(0, 10_000) });
}
```

**Acceptance:** On a corpus of 100 documents, `getMiniSearch` completes in under 200 ms (measure with `performance.now()`). IDB read count drops from N×M to N.

---

## AIL-4 — `AIProfileFacetService.build`: versioned facet update is non-atomic — concurrent `getAll` sees mixed state 🟠

**Context:** `src/features/ai/services/AIProfileFacetService.ts:339–346`

```ts
for (const f of newFacets) await db.put('aiProfileFacets', f);  // new written
const oldFacets = await db.getAll('aiProfileFacets');            // reads mix of old+new
for (const f of oldFacets) {
  if (!newIds.has(f.id)) await db.delete('aiProfileFacets', f.id);
}
```

`withFacetLock` serialises other facet mutations, but `getAll()` (called from UI components, diagnostics, portrait builder) is not behind the lock. Between the first `put` pass and the `delete` pass, any reader sees both old and new facets simultaneously — duplicate profile themes can flash in the UI.

**Fix:** wrap the entire write-then-delete block in one IDB `readwrite` transaction:
```ts
const tx = db.transaction('aiProfileFacets', 'readwrite');
for (const f of newFacets) await tx.store.put(f);
const all = await tx.store.getAll();
for (const f of all) {
  if (!newIds.has(f.id)) await tx.store.delete(f.id);
}
await tx.done;
```

**Acceptance:** During an active `build()`, `getAll()` from any other context returns either the complete old set or the complete new set — never a mix. Verifiable in the Diagnostics page (facet count should not spike during rebuild).

---

## AIL-5 — `AIProfileFacetService.build`: taxonomy domain embeddings re-requested on every rebuild 🟠

**Context:** `src/features/ai/services/AIProfileFacetService.ts:117–121`

```ts
for (const d of taxonomy) {
  const res = await AIService.embed({ content: d.seed });
  if (res.ok && res.vectors[0]) domainVecs.push(...);
}
```

Each `build()` call embeds every taxonomy domain from scratch — 10 sequential `embedDocument` calls → 10 `tryReserveGlobalRequest` slots. If `build()` is triggered after each new note (incremental pipeline), this cost multiplies with corpus size.

**Fix:** cache domain vectors in IDB keyed by `sha1(seed + model)` (or simply `${domain.id}_${embedModel}`). On `build()`, load cached vectors; only re-embed domains whose seed or model changed:

```ts
// aiTaxonomyService or a new aiDomainVectorCache:
const cached = await db.get('aiDomainVectors', cacheKey);
if (cached) { domainVecs.push(cached); continue; }
const res = await AIService.embed({ content: d.seed });
// ... save to cache
```

**Acceptance:** Second and subsequent `build()` calls with the same taxonomy make 0 embed calls for domain seeds. A taxonomy change (seed edit) triggers only 1 re-embed for the changed domain.

---

## AIL-6 — `embedDocument`: vector count not validated against chunk count — misaligned arrays on partial OpenRouter response 🟡

**Context:** `functions/src/ai/embedDocument.ts:62–73`, `functions/src/shared/aiProvider.ts:160–167`

```ts
const chunks = chunkText(sanitized);
const result = await embed(chunks);
return { vectors: result.vectors, chunks, model: result.model, dim: result.dim };
```

If OpenRouter returns fewer embedding vectors than input texts (partial upstream response, dropped items), `vectors.length < chunks.length`. The client stores both arrays separately and uses chunk index to map vectors to text windows. A misaligned index causes wrong text to be shown in search results — silently, with no error.

**Fix:** add a guard in `embedDocument.ts` before returning:
```ts
if (result.vectors.length !== chunks.length) {
  await refundGlobalRequest();
  throw new HttpsError('internal', `Embedding count mismatch: got ${result.vectors.length} for ${chunks.length} chunks.`);
}
```

**Acceptance:** If OpenRouter returns a partial embedding batch, the function throws `internal` and refunds the global slot. The client's `AIEmbeddingService` catches this as a failed embed and leaves `cloudSyncedAt` unset for retry.

---

## AIL-7 — `searchNotesMulti`: cache key is only `queries[0]`, not the full query set 🟡

**Context:** `src/features/ai/utils/noteRetriever.ts:289–295`

```ts
const cached = getCached(queries[0]!);   // misses if same queries in different order
// ...
putCache(queries[0]!, results);
```

Two calls with `['тревога', 'работа']` and `['работа', 'тревога']` produce the same combined embedding and the same results, but hit different cache keys. Also: a single-query `searchNotes('тревога')` and a multi-query `searchNotesMulti(['тревога', 'другое'])` share the same cache slot if `queries[0]` matches — they can return stale results for each other.

**Fix:** use a stable sorted join as the cache key:
```ts
const cacheKey = [...queries].sort().join('\x00');
const cached = getCached(cacheKey);
// ...
putCache(cacheKey, results);
```

**Acceptance:** `searchNotesMulti(['тревога', 'работа'])` and `searchNotesMulti(['работа', 'тревога'])` share the same cache entry. A single-query and multi-query with the same first term do NOT share a cache entry.

---

## AIL-8 — `searchCache` stores full note content in heap — unbounded memory across long sessions 🟡

**Context:** `src/features/ai/utils/noteRetriever.ts:28–31`, `268–273`

```ts
const searchCache: SearchCacheEntry[] = [];  // module-level, survives page lifetime
// entries store full RetrievedNote[] with content up to 10K chars per note
```

50 entries × 5 notes × 10K chars = ~2.5 MB of diary content kept in JS heap for up to 5 minutes past last access. In a long session with many searches, old entries pile up. Content is personal — keeping it in a module-level array longer than the render cycle is an unnecessary exposure window.

**Fix:** store only IDs and scores in the cache; hydrate content on demand:
```ts
interface SearchCacheEntry {
  timestamp: number;
  query: string;
  results: { documentId: string; score: number; chunkIndex?: number }[];  // no content
}
```
`loadNotes()` already does content hydration from IDB — calling it again on cache hit costs <5 ms for 5 documents.

**Acceptance:** Cache entries contain no `content` strings. Heap usage after 50 cached searches is under 100 KB for the cache structure.

---

## AIL-9 — `NAME_ALIASES` in `AIProfileFacetService` hardcodes 6 names — most Russian names create duplicate person facets 🟡

**Context:** `src/features/ai/services/AIProfileFacetService.ts:59–66`

```ts
const NAME_ALIASES: Record<string, string[]> = {
  'саша': ['саша','сашу','саше',...],
  'юля': [...], 'наташа': [...], 'даша': [...], 'мама': [...], 'папа': [...]
};
```

Names Аня, Лена, Катя, Дима, Вася, and thousands of others fall through with no canonicalization. The `summarizeDocument` function already returns `mentionedPeople[].name` normalized to nominative by the LLM. `AIProfileFacetService` then calls `canonicalName()` on those names, but for any name outside the 6-entry alias table, inflected forms (Аню / Ане / Аней) create separate facets instead of merging.

**Fix:** replace the alias-based `canonicalName()` with a normalization step at the point of extraction. Since `mentionedPeople` from `summarizeDocument` already provides nominative names (the LLM instructs: "имя или прозвище"), simply deduplicate by lowercased name across summaries without the alias table:
```ts
// Remove canonicalName() call entirely.
// Group by p.name.toLowerCase() directly — LLM already gives nominative form.
const key = p.name.toLowerCase();
```

**Acceptance:** "Аня", "Аню", "Ане" from different summaries appear as one person facet ("Аня") in the profile. The 6 hardcoded aliases can be removed. Regression check: Саша/Александр still merges (the LLM returns consistent nominative names).

---

## AIL-10 — `aiProvider.generateOpenRouter`: retry swallows the per-attempt error body on 502/503 — upstream provider undiagnosable from logs 🟡

**Context:** `functions/src/shared/aiProvider.ts:88–96`

```ts
const transient = res.status === 502 || res.status === 503 || res.status === 504;
if (transient && attempt < MAX_ATTEMPTS) {
  await new Promise(r => setTimeout(r, 500 * attempt));
  continue;
}
const errText = await res.text().catch(() => '');
throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
```

On transient errors, the response body is never read — it's silently discarded and retry fires. OpenRouter's 502/503 bodies often contain the upstream provider name and reason (`{"error":{"code":503,"message":"Provider X is overloaded"}}`). Without logging this, diagnosing recurring provider failures is impossible.

**Fix:** log the body on transient retries before continuing:
```ts
if (transient && attempt < MAX_ATTEMPTS) {
  const body = await res.text().catch(() => '');
  console.warn(`[aiProvider] attempt ${attempt} transient ${res.status}: ${body.slice(0, 200)}`);
  await new Promise(r => setTimeout(r, 500 * attempt));
  continue;
}
```

**Acceptance:** A 503 from an upstream provider appears in Firebase Function logs with the provider name and reason. No change to retry behaviour.

---

## Not doing (explicitly excluded)

- **Replacing `MiniSearch` with a server-side BM25** — the hybrid local search is a feature, not a bug; fixing AIL-3 (O(1) latest version fetch) is sufficient.
- **Expanding `NAME_ALIASES` to cover more names** — the correct fix (AIL-9) removes the alias table entirely; adding more entries would be tech debt in the wrong direction.
- **Adding per-user limits to `rerankNotes`** — reranking is infrastructure (costs <10 tokens per call); global guard is sufficient.
