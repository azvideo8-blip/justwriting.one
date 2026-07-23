# Embeddings 1MB sync jam + CI deploy-on-push — Antigravity tickets (July 2026)

Self-contained. Prefix: `EMB-` / `CI-`. Owner reviews after.

## Guardrails
- Lint per changed file (`npm run lint` OOMs). `npx tsc --noEmit` in root AND `functions/`.
- No new deps.

---

## EMB-1 — An embeddings doc exceeds Firestore's 1 MB limit and jams the sync queue 🔴

**Symptom (prod console):**
```
Document '…/embeddings/local_67f79c58-…' cannot be written because its size
(1,077,976 bytes) exceeds the maximum allowed size of 1,048,576 bytes.
```
It repeats on every sync — it's a **permanent** failure stuck in `syncPendingToCloud` (`index-…:319`), not a transient one. A refresh does not clear it.

**Root cause:** `AIEmbeddingService` writes one Firestore doc per note at `embeddings/{documentId}` (`setDoc(..., encrypted, { merge: true })`). The doc holds `nsJson` (every chunk's vector) + `chunkTextsJson` (every chunk's text), encrypted. For a long note the chunk count is large, and JSON-serialized float arrays are bulky (a float ≈ 11 bytes in JSON vs 4 as Float32), so the blob crosses Firestore's hard 1 MB cap. The write can never succeed → it blocks/re-tries forever.

**Fix (embeddings are a *rebuildable local cache* — losing a note's cloud copy is safe; it re-embeds on the device that has the note):**
1. **Guard the cloud write by size.** Before the `setDoc`, measure the serialized `encrypted` payload (`new Blob([JSON.stringify(encrypted)]).size` or `TextEncoder`). If it exceeds a safe threshold (use **≤ 1,000,000 bytes**, headroom under 1,048,576):
   - First try shrinking: **omit `chunkTextsJson` from the cloud doc** (it's the largest reducible field and is recomputable from the note text locally). Keep `nsJson`.
   - If still over the threshold, **skip the cloud write for that doc** and mark it so the sync queue treats it as **done/permanently-skipped, not pending-retry** (e.g. a `cloudSkipped`/`oversized` flag on the local record). It stays in IndexedDB and still works locally.
2. **Stop the infinite retry.** Wherever `syncPendingToCloud` enqueues/marks embeddings, a doc that fails the size check (or returns the Firestore `invalid-argument`/size error) must be removed from the pending set — not left to re-fail every cycle. Distinguish this permanent failure from transient network errors (`ERR_NETWORK_CHANGED`, `unavailable`), which SHOULD still retry.
3. (Optional, only if trivial) cap chunks-per-note when embedding very long notes so new docs stay well under the limit — but the size guard above is the actual fix; don't block on this.

**Acceptance:** the oversized `local_67f79c58-…` embedding no longer errors on sync — it's either shrunk under the limit or skipped and dropped from the pending queue (no repeat every sync); normal-size embeddings still sync; transient network failures still retry; a unit test covers "oversized payload → skipped, not retried."

**Note for owner:** the huge wall of `WebChannelConnection RPC transport errored` / `ERR_NETWORK_CHANGED` / `ERR_CONNECTION_CLOSED` in the same console dump is **transient network flapping**, not an app bug — no ticket. Only the 1 MB write is actionable.

---

## CI-2 — Deploy Cloud Functions on push to `main`, not only on PR merge 🟡

**Context:** `.github/workflows/ci.yml` `deploy-functions` job is gated by
```yaml
if: github.event.pull_request.merged == true && github.base_ref == 'main'
```
We push **directly** to `main`, so functions never auto-deploy — every `functions/**` change needs a manual `firebase deploy --only functions` (this is how the deriveTaxonomy fix and earlier server changes sat undeployed).

**Fix:**
1. Change the `deploy-functions` `if` to also fire on a direct push to main:
   ```yaml
   if: >
     (github.event_name == 'push' && github.ref == 'refs/heads/main') ||
     (github.event.pull_request.merged == true && github.base_ref == 'main')
   ```
   Confirm the workflow's top-level `on:` includes `push: { branches: [main] }` (add if missing) so the push event reaches the job.
2. **Path-scope it** so unrelated pushes don't redeploy functions on every commit: gate on `functions/**` changes (a `paths:` filter on the push trigger, or a `dorny/paths-filter` step the job depends on). Frontend-only pushes shouldn't trigger a functions deploy.
3. While here: the **rollback list is stale** — the `functions:delete` line omits newer functions (`deriveTaxonomy`, `judgeFacets`, `extractChatMemory`). Either update it to match the deployed set or (simpler, safer) drop the destructive `functions:delete` rollback — deleting live functions on a failed deploy is riskier than leaving the previous version running. Recommend removing the delete-based rollback.

**Acceptance:** a push to `main` that touches `functions/**` runs `deploy-functions` and deploys; a push that touches only frontend does not; PR-merge deploys still work; no stale/destructive rollback step.
