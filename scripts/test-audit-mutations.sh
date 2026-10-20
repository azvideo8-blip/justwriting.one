#!/usr/bin/env bash
# TEST-1 runner: mutation checks (red→green) for every audited fix + proofs.
# Usage: bash scripts/test-audit-mutations.sh
# Output: docs/TEST1-protocol.md — one line per mutation, plus proofs.
set -u
# L-10 (sweep encoding): те же 40 mutation-скриптов на python — cp1251 нельзя.
export PYTHONUTF8=1
cd "$(dirname "$0")/.."

CHECK_MODE=0
for arg in "$@"; do
  if [ "$arg" = "--check" ]; then
    CHECK_MODE=1
  fi
done

failures=0

if [ "$CHECK_MODE" = "1" ]; then
  OUT="${GITHUB_STEP_SUMMARY:-/dev/null}"
else
  OUT=docs/TEST1-protocol.md
fi
if [ "$OUT" != "/dev/null" ]; then
  : > "$OUT"
fi
log() {
  if [ "$OUT" != "/dev/null" ]; then
    echo "$*" | tee -a "$OUT"
  else
    echo "$*"
  fi
}

run_vitest() { npx vitest run "$1" ${2:+-t "$2"} 2>&1 | grep -E "Tests " | tail -1; }

expect_fail() { # file test-name-filter mutation-label
  # Проверяем НАЛИЧИЕ падения, а не отсутствие строки " 0 failed". Прежний
  # вариант печатал «RED as required» и на зелёном прогоне: vitest в этом случае
  # выводит «Tests 5 passed (5)», подстроки " 0 failed" там нет, и условие
  # уходило в else. То есть проверка, написанная чтобы ловить тесты, которые
  # проходят при снятой защите, сама проходила при любом исходе.
  local res; res=$(run_vitest "$1" "$2")
  if [ -z "$res" ]; then
    log "❌ $3 — фильтр не выбрал ни одного теста"
    failures=$((failures + 1))
    return
  fi
  if echo "$res" | grep -qE "[1-9][0-9]* failed"; then
    log "✅ $3 — RED as required ($res)"
  else
    log "❌ $3 — тест НЕ упал: он не покрывает эту правку ($res)"
    failures=$((failures + 1))
  fi
}

expect_pass() { # file test-name-filter mutation-label
  local res; res=$(run_vitest "$1" "$2")
  # L-10 (R4-068): пустой вывод (крэш после restore) — не «GREEN», а провал.
  if [ -z "$res" ]; then
    log "❌ $3 — прогон после restore не дал вывода"
    failures=$((failures + 1))
    return
  fi
  if echo "$res" | grep -qE "[1-9][0-9]* failed"; then
    log "❌ $3 — still failing after restore ($res)"
    failures=$((failures + 1))
  else
    log "✅ $3 — GREEN after restore ($res)"
  fi
}

# Мутация обязана изменить файл. Скрипты мутаций — это str.replace по точной
# строке: стоит исходнику сдвинуться на пробел, замена молча ничего не делает,
# защита остаётся на месте, тест закономерно зелёный, и протокол записывает
# «RED as required». Ровно так пункт 2.4 полгода выглядел проверенным.
assert_mutated() { # file label
  if git diff --quiet -- "$1"; then
    log "❌ $2 — МУТАЦИЯ ПУСТАЯ: файл не изменился, проверка ничего не значит"
    failures=$((failures + 1))
    return 1
  fi
  return 0
}

mutate() { # file python-replace-file
  python3 - "$1" "$2" <<'PY'
import sys, re
path, script = sys.argv[1], sys.argv[2]
code = open(script).read() if script.startswith('/') or script.startswith('.') else open(f'scripts/mutations/{script}').read()
ns = {}
exec(compile(open('scripts/mutations/_apply.py').read(), '_apply.py', 'exec'), ns)
ns['apply'](path, code)
PY
}

restore() { git checkout -- "$1"; }

log "# TEST-1 mutation protocol — $(date '+%Y-%m-%d %H:%M')"
log ""

apply_mutation() { # label file patchfile testfile testfilter
  local label="$1" file="$2" patch="$3" tf="$4" filt="$5"
  # restore = git checkout: на файле с незакоммиченной правкой она бы её стёрла,
  # а assert_mutated принял бы чужую правку за мутацию.
  if ! git diff --quiet -- "$file"; then
    log "❌ $label — $file с незакоммиченными правками, мутацию не запускаю"
    failures=$((failures + 1))
    return
  fi
  mutate "$file" "$patch"
  if ! assert_mutated "$file" "$label"; then restore "$file"; return; fi
  expect_fail "$tf" "$filt" "$label (guard removed)"
  restore "$file"
  expect_pass "$tf" "$filt" "$label (restored)"
}

mkdir -p scripts/mutations docs

# ---------- api ----------
cat > scripts/mutations/m15.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("         tokens     = coalesce(public.ai_global_daily.tokens, 0) + $3::int\n","")
open(p,'w').write(s)
EOF
cat > scripts/mutations/m219.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("[uid, chargedDay, kind],", "[uid, today(), kind],")
open(p,'w').write(s)
EOF
apply_mutation "1.5 reserve tokens in-statement" api/postgresAiContext.ts m15.py \
  api/__tests__/postgresQuota.test.ts "" 
apply_mutation "2.19 refund charged day" api/postgresAiContext.ts m219.py \
  api/__tests__/postgresQuota.test.ts ""

cat > scripts/mutations/m38.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
# 3.8 (0.10.3): оба обработчика close начинаются с clientClosed = true,
# во втором ещё clearTimeout(deadlineId) — шаблон держит обе ветки.
s=s.replace("""  res.on('close', () => {
    clientClosed = true;
    controller.abort();
    void settlement.settle('closed').catch((e) => console.error('[chat] settle on close', e));
  });""","")
s=s.replace("""  res.on('close', () => {
    clientClosed = true;
    clearTimeout(deadlineId);
    controller.abort();
    void settlement.settle('closed').catch((e) => console.error('[chat] settle on close', e));
  });""","")
open(p,'w').write(s)
EOF
apply_mutation "3.8 close-handler refund" api/chat.ts m38.py \
  api/__tests__/chatStreamClose.test.ts "refunds once"

# 2.18 langfuse hashUid — obsolete, Langfuse dropped in EA-11

cat > scripts/mutations/m220.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""  const validated = summarySchema.safeParse(rawParsed);
  if (!validated.success) {""","""  const validated = { success: true as const, data: rawParsed as never };
  if (false) {""")
open(p,'w').write(s)
EOF
apply_mutation "2.20 summary zod gate" api/ai/summarizeDocument.logic.ts m220.py \
  api/__tests__/aiLogic.test.ts "frequentWords"

# ---------- data layer ----------
cat > scripts/mutations/m29.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace(".eq('version', parseVersionNumber(versionId));",".eq('version', parseInt(versionId, 10));")
open(p,'w').write(s)
EOF
apply_mutation "2.9 parseVersionNumber" src/core/data/providers/versions.ts m29.py \
  src/core/data/__tests__/auditCleanup.test.ts 'updateVersion filters'

cat > scripts/mutations/m215.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
# 2.15 (0.10.3): catch (updateError) вместо if (updateError != null).
s=s.replace("""      } catch (updateError) {
        failedUuids.push(doc.uuid ?? '');
        reportError(updateError, { action: 'renameTagInAllDocs_update', docUuid: doc.uuid });
      }""","""      } catch (updateError) {
        reportError(updateError, { action: 'renameTagInAllDocs_update', docUuid: doc.uuid });
      }""")
open(p,'w').write(s)
EOF
apply_mutation "2.15 tag partial throw" src/core/data/providers/documents.ts m215.py \
  src/core/data/__tests__/auditCleanup.test.ts 'renameTag throws'

cat > scripts/mutations/m213.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("  content: z.string(),\n  title: z.string().nullish(),\n  savedDocumentId: z.string().nullish(),",
            "  content: z.unknown().optional(),\n  title: z.unknown().nullish(),\n  savedDocumentId: z.unknown().nullish(),")
open(p,'w').write(s)
EOF
apply_mutation "2.13 draft schema strictness" src/core/data/schemas.ts m213.py \
  src/core/data/__tests__/auditCleanup.test.ts 'content as a number'

# ---------- retrieval ----------
cat > scripts/mutations/m24.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""    .flatMap(e => [e.slice(0, -1), ...(e.length >= 6 ? [e.slice(0, -2)] : [])])
    .filter(stem => stem.length >= 3);""","""    .map(e => e.slice(0, -1))
    .filter(stem => stem.length >= 3);""")
open(p,'w').write(s)
EOF
apply_mutation "2.4 stemmer adaptive stems" src/features/ai/utils/retrieval/literalMatches.ts m24.py \
  src/features/ai/utils/__tests__/noteRetriever.literal.test.ts 'two-letter stem'

cat > scripts/mutations/m25.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""export function vectorScore01(raw: number): number {
  return Math.min(1, Math.max(0, raw) * 20);
}""","""export function vectorScore01(raw: number): number {
  return Math.max(0, raw);
}""")
open(p,'w').write(s)
EOF
apply_mutation "2.5 RRF normalisation" src/features/ai/utils/retrieval/fusion.ts m25.py \
  src/features/ai/utils/__tests__/noteRetriever.literal.test.ts 'typical RRF ceiling'

# ---------- client ----------
cat > scripts/mutations/m12.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("      flowType: 'pkce',\n","")
open(p,'w').write(s)
EOF
apply_mutation "1.2 PKCE flowType" src/core/supabase/client.ts m12.py \
  src/core/supabase/__tests__/clientPkce.test.ts "flowType pkce"

cat > scripts/mutations/m13.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""    const unsub = onPasswordRecovery(() => {
      setRecoveryMode(true);""","""    const unsub = onPasswordRecovery(() => {""")
open(p,'w').write(s)
EOF
apply_mutation "1.3 recovery detection" src/features/auth/pages/ResetPasswordPage.tsx m13.py \
  src/features/auth/pages/__tests__/ResetPasswordPage.test.tsx "reveals the form"

cat > scripts/mutations/m16.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("    if (setupInFlightRef.current || loading) return;","    if (loading) return;")
open(p,'w').write(s)
EOF
apply_mutation "1.6 vault setup ref-guard" src/features/encryption/components/EncryptionPasswordModal.tsx m16.py \
  src/features/encryption/components/__tests__/EncryptionPasswordModal.test.tsx 'двойной сабмит'

cat > scripts/mutations/m22.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("sessionStartWords: wordCount ?? state.sessionStartWords,","sessionStartWords: wordCount ?? 0,")
open(p,'w').write(s)
EOF
apply_mutation "2.2 store baseline fallback" src/features/writing/store/useTimerStore.ts m22.py \
  src/features/writing/store/__tests__/setWordGoal.baseline.test.ts "keeps the baseline"

cat > scripts/mutations/m26.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('doc-version-saved', { detail: { documentId } }));
  }""","")
open(p,'w').write(s)
EOF
apply_mutation "2.6 doc-version-saved dispatch" src/core/services/StorageService.ts m26.py \
  src/core/services/__tests__/docVersionSavedEvent.test.ts "dispatches with the saved document id"

cat > scripts/mutations/m27.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""          const isGuest = user.uid.startsWith('guest');
          const key = isGuest ? STORAGE_KEYS.GUEST_DRAFT : `draft-${user.uid}`;""","""          const key = `draft-${user.uid}`;""")
s=s.replace("          if (!isGuest && getEncryptionEnabled(user.uid)) {","          if (getEncryptionEnabled(user.uid)) {")
open(p,'w').write(s)
EOF
apply_mutation "2.7 guest unload key" src/features/writing/hooks/useDraftCore.ts m27.py \
  src/features/writing/hooks/__tests__/guestUnloadKey.test.ts "writes to STORAGE_KEYS.GUEST_DRAFT"

cat > scripts/mutations/m28.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
# AG-5 (2026-09-27): удаление источника переехало внутрь ветки «записано в аккаунт».
# 0.10.3: отступ 6 пробелов, у localStorage — 4.
s=s.replace("""      await guestDb.delete('drafts', 'guest_draft');
      if (userDb !== guestDb) {""","""      if (userDb !== guestDb) {""")
s=s.replace("""    try { localStorage.removeItem(STORAGE_KEYS.GUEST_DRAFT); } catch { /* ignore */ }""","")
open(p,'w').write(s)
EOF
apply_mutation "2.8 guest draft consumed" src/features/auth/services/migrateDocuments.ts m28.py \
  src/features/auth/services/__tests__/migrateDraftConsumed.test.ts "copies to the user"

cat > scripts/mutations/m212.py <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("      wordsByDate[key] = (wordsByDate[key] || 0) + (s.sessionWordsAdded || s.wordCount || 0);",
            "      wordsByDate[key] = (wordsByDate[key] || 0) + (s.wordCount || 0);")
open(p,'w').write(s)
EOF
apply_mutation "2.12 heatmap delta" src/features/profile/components/Heatmap.tsx m212.py \
  src/features/profile/components/__tests__/heatmap.delta.test.ts "paints ~3"

log ""
log "## Non-vitest proofs"
bash scripts/audit-proofs.sh >> "$OUT" 2>&1
proofs_rc=$?
if [ $proofs_rc -ne 0 ]; then
  failures=$((failures + 1))
  log "❌ audit-proofs.sh failed with exit code $proofs_rc"
else
  log "✅ audit-proofs.sh passed"
fi
log "See audit-proofs output above."

log ""
log "## Final gates"
typecheck_rc=0
npm run typecheck >/dev/null 2>&1 || typecheck_rc=$?
if [ $typecheck_rc -ne 0 ]; then
  log "- typecheck: FAIL"
  failures=$((failures + 1))
else
  log "- typecheck: OK"
fi

lint_rc=0
npm run lint:changed >/dev/null 2>&1 || lint_rc=$?
if [ $lint_rc -ne 0 ]; then
  log "- lint:changed: FAIL"
  failures=$((failures + 1))
else
  log "- lint:changed: OK"
fi

log "- RLS suite: see docker command in audit-cleanup-plan.md (private justwriting-docs) (requires Docker)"
echo "Protocol written to $OUT"

# L-10 (R4-068): протокол с провалами должен быть красным всегда, а не только
# в --check — без этого скрипт-гейт рапортовал успех при любом исходе.
exit $((failures > 0))
