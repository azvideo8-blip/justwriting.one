#!/usr/bin/env node
/**
 * scripts/postulates.mjs
 *
 * Verifies the four postulates before beta:
 * 1 — What a person writes locally is never lost
 * 2 — Nothing leaves for the cloud unencrypted
 * 3 — AI is the one disclosed exception
 * 4 — Saved, encrypted, synchronised, nothing leaked
 *
 * Usage:
 *   npm run postulates
 *   DATABASE_URL=postgres://... npm run postulates
 *
 * Output:
 *   Part 1: Lifecycle matrix runner (both vault states) with 3-valued table
 *   Part 2: Live Postgres sweep (counts only, never row content)
 *   Part 3: Final verdict (exits non-zero on any violation)
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper to format 3-valued boolean
export function formatThreeValued(val) {
  if (val === true) return 'true (held)';
  if (val === false) return 'FALSE';
  return 'not measured';
}

export const ENC_COLS = [
  { table: 'documents', col: 'title' },
  { table: 'documents', col: 'mood' },
  { table: 'versions', col: 'content' },
  { table: 'versions', col: 'mood' },
  { table: 'drafts', col: 'title' },
  { table: 'drafts', col: 'content' },
  { table: 'ai_summaries', col: 'summary' },
  { table: 'ai_summaries', col: 'tone' },
  { table: 'ai_embeddings', col: 'chunk_texts_json' },
  {
    table: 'local_store_records',
    col: 'payload.data',
    flag: `payload->>'_encrypted' = 'true'`,
    val: `payload->>'data'`,
  },
  {
    table: 'users',
    col: 'labels.name',
    from: `public."users", jsonb_array_elements(CASE WHEN jsonb_typeof(labels) = 'array' THEN labels ELSE '[]'::jsonb END) AS elem`,
    flag: `elem->>'_encrypted' = 'true'`,
    val: `elem->>'name'`,
  },
];

// TB-03: Все стендовые фикстуры supabase/tests/rls.test.sql принадлежат
// зарезервированным uid (00000000-0000-0000-0000-0000000000NN).
// Обход базы в постулатах проверяет только живые данные пользователей и
// исключает все тестовые фикстуры по единому правилу префикса uid.
export const RESERVED_FIXTURE_UID_PREFIX = '00000000-0000-0000-0000-0000000000';

export function getFixtureFilter(table, prefix = '') {
  const p = prefix ? `${prefix}.` : '';
  if (table === 'users') {
    return `public."users".uid::text NOT LIKE '${RESERVED_FIXTURE_UID_PREFIX}%'`;
  }
  return `${p}user_id::text NOT LIKE '${RESERVED_FIXTURE_UID_PREFIX}%'`;
}

export const CENSUS_TABLES = [
  { table: 'documents', unencrypted: `_encrypted IS NOT TRUE AND user_id::text NOT LIKE '${RESERVED_FIXTURE_UID_PREFIX}%'` },
  { table: 'versions', unencrypted: `_encrypted IS NOT TRUE AND user_id::text NOT LIKE '${RESERVED_FIXTURE_UID_PREFIX}%'` },
  { table: 'drafts', unencrypted: `_encrypted IS NOT TRUE AND user_id::text NOT LIKE '${RESERVED_FIXTURE_UID_PREFIX}%'` },
  { table: 'ai_summaries', unencrypted: `_encrypted IS NOT TRUE AND user_id::text NOT LIKE '${RESERVED_FIXTURE_UID_PREFIX}%'` },
  { table: 'ai_embeddings', unencrypted: `_encrypted IS NOT TRUE AND user_id::text NOT LIKE '${RESERVED_FIXTURE_UID_PREFIX}%'` },
  { table: 'local_store_records', unencrypted: `payload->>'_encrypted' IS DISTINCT FROM 'true' AND user_id::text NOT LIKE '${RESERVED_FIXTURE_UID_PREFIX}%'` },
];

export function entryFrom(table, col, cols = ENC_COLS) {
  const e = cols.find(x => x.table === table && x.col === col);
  return e?.from ?? `public."${table}"`;
}

export function entryFlag(table, col, cols = ENC_COLS) {
  const e = cols.find(x => x.table === table && x.col === col);
  return e?.flag ?? '_encrypted = true';
}

export function entryVal(table, col, cols = ENC_COLS) {
  const e = cols.find(x => x.table === table && x.col === col);
  return e?.val ?? `"${col}"`;
}

/**
 * @param {Array<any>} results
 * @param {number | null} [maxUnmeasured=null]
 */
export function evaluateMatrixResults(results, maxUnmeasured = null) {
  let anyFalse = false;
  const violations = [];
  // EA-7: ячейка, которая упала и ничего не вернула, — не «не нарушено».
  const brokenCells = results.filter(r => !r || typeof r !== 'object').length;
  results = results.filter(r => r && typeof r === 'object');

  // GT-2: ячейка с fault !== 'none', у которой faultFired === 0 — ловушка
  // никогда не сработала, значит постулат проверен на пустом месте.
  const faultNeverFiredCells = results.filter(
    r => r.fault !== 'none' && (r.faultFired === 0 || r.faultFired === undefined)
  );
  if (faultNeverFiredCells.length > 0) {
    for (const r of faultNeverFiredCells) {
      violations.push({
        seq: r.sequence,
        fault: r.fault,
        step: r.step,
        vault: r.vaultEnabled,
        notes: [`fault never fired (faultFired=${r.faultFired ?? 'undefined'})`, ...(r.notes || [])],
      });
    }
  }
  const totalBrokenCells = brokenCells + faultNeverFiredCells.length;
  results = results.filter(
    r => r.fault === 'none' || (r.faultFired !== undefined && r.faultFired > 0)
  );


  const darkCells = [];
  for (const r of results) {
    if (r.p1Held === false || r.p2Held === false || r.p3Held === false || r.p4Held === false) {
      anyFalse = true;
      violations.push({
        seq: r.sequence,
        fault: r.fault,
        step: r.step,
        vault: r.vaultEnabled,
        notes: r.notes || [],
      });
    }

    // Храповик считает только применимые ячейки: без сейфа P2 («уходит
    // зашифрованным») неприменим по определению, а с ним и P4, который из P2
    // собран. Иначе ~3/4 счёта — шум, и храповик стережёт не дыры, а его.
    // seq9 начинает без сейфа и включает его сам: после удачного включения P2/P4
    // применимы, хотя ячейка помечена «vault off». Без этого их потерю храповик
    // не заметил бы — применимость решала бы разметка матрицы, а не смысл (N-40).
    const vaultBecameOn = String(r.sequence).startsWith('seq9_') && r.told?.status !== 'error_thrown';
    const applies = { P1: true, P2: !!r.vaultEnabled || vaultBecameOn, P3: true, P4: !!r.vaultEnabled || vaultBecameOn };
    const missing = ['P1', 'P2', 'P3', 'P4'].filter(p => applies[p] && r[`p${p[1]}Held`] === undefined);
    if (missing.length > 0) {
      darkCells.push({
        seq: r.sequence,
        fault: r.fault,
        step: r.step,
        vault: r.vaultEnabled,
        missing,
      });
    }
  }

  const tally = ['p1Held', 'p2Held', 'p3Held', 'p4Held'].map(k => {
    const c = { held: 0, notMeasured: 0, violated: 0 };
    for (const r of results) {
      if (r[k] === true) c.held++;
      else if (r[k] === false) c.violated++;
      else c.notMeasured++;
    }
    return c;
  });

  const totalUnmeasured = darkCells.reduce((sum, d) => sum + d.missing.length, 0);
  const unmeasuredExceeded = maxUnmeasured !== null && totalUnmeasured > maxUnmeasured;

  // EA-7: зелёный вердикт без единого измерения — не зелёный. Пустая матрица,
  // сломанные ячейки или постулат, который не удалось проверить ни разу, — провал.
  const unmeasured = tally.map((c, i) => (c.held + c.violated === 0 ? i + 1 : null)).filter(Boolean);
  const incomplete = results.length === 0 || totalBrokenCells > 0 || unmeasured.length > 0;
  return {
    success: !anyFalse && !incomplete && !unmeasuredExceeded,
    totalCells: results.length,
    brokenCells: totalBrokenCells,
    faultNeverFired: faultNeverFiredCells.length,
    unmeasured,
    violations,
    tally,
    totalUnmeasured,
    unmeasuredExceeded,
    darkCells,
    maxUnmeasured,
  };
}

const HELP_TEXT = `
Usage: node scripts/postulates.mjs [options]

Options:
  --max-unmeasured <N>   Fail if the number of unmeasured matrix cells (cells
                         where a postulate could not be evaluated) exceeds N.
                         Default: no limit. Use 0 to enforce full coverage.
                         N counts individual cells (e.g. one sequence × vault
                         state × postulate slot), not postulate types.
  --require-db           Fail if DATABASE_URL is not set or if any DB check is
                         skipped.
  --help, -h             Print this help and exit 0.

Examples:
  node scripts/postulates.mjs
  node scripts/postulates.mjs --max-unmeasured 0
  DATABASE_URL=postgres://... node scripts/postulates.mjs --require-db
`.trimStart();

/**
 * @param {number | null} [maxUnmeasured=null]
 */
export async function runLifecycleMatrix(maxUnmeasured = null) {
  console.log('================================================================');
  console.log('PART 1: LIFECYCLE MATRIX RUNNER (FAULT-INJECTION HARNESS)');
  console.log('================================================================');
  console.log('Running 10 canonical sequences across fault conditions and vault states...\n');

  const tmpOut = path.join(rootDir, `.postulates-results-${Date.now()}.json`);
  try {
    // Один файл — один форк: вложенный прогон не должен плодить воркеры рядом
    // с внешним vitest (тест postulatesCommand запускает его изнутри прогона).
    try {
      execSync(`npx vitest run -c vitest.runner.config.ts --silent --maxWorkers=1`, {
        cwd: rootDir,
        env: {
          ...process.env,
          POSTULATES_RESULTS_PATH: tmpOut,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      console.error('\n[!] Nested matrix vitest runner failed:');
      const stdout = typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString('utf8');
      const stderr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString('utf8');
      if (stdout) console.error(stdout);
      if (stderr) console.error(stderr);
      throw err;
    }

    if (!fs.existsSync(tmpOut)) {
      throw new Error('Matrix runner failed to produce results file');
    }

    const results = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
    const evalResult = evaluateMatrixResults(results, maxUnmeasured);

    // Print summary table
    console.log(
      'Sequence'.padEnd(38) +
      'Vault'.padEnd(8) +
      'Fault'.padEnd(24) +
      'P1'.padEnd(16) +
      'P2'.padEnd(16) +
      'P3'.padEnd(16) +
      'P4'
    );
    console.log('-'.repeat(128));

    for (const r of results) {
      const p1 = formatThreeValued(r.p1Held);
      const p2 = formatThreeValued(r.p2Held);
      const p3 = formatThreeValued(r.p3Held);
      const p4 = formatThreeValued(r.p4Held);

      const line =
        r.sequence.padEnd(38) +
        (r.vaultEnabled ? 'ON' : 'off').padEnd(8) +
        r.fault.padEnd(24) +
        p1.padEnd(16) +
        p2.padEnd(16) +
        p3.padEnd(16) +
        p4;
      console.log(line);
    }

    console.log('-'.repeat(128));

    if (evalResult.violations.length > 0) {
      console.log('\n[!] MATRIX VIOLATIONS DETECTED:');
      for (const v of evalResult.violations) {
        console.log(`  - ${v.seq} (vault: ${v.vault}, fault: ${v.fault}, step: ${v.step})`);
        for (const n of v.notes) {
          console.log(`      * ${n}`);
        }
      }
    } else {
      console.log('\n[✓] Matrix completed: all measured postulates held.');
    }

    if (evalResult.unmeasuredExceeded) {
      console.log(`\n[!] UNMEASURED CELLS LIMIT EXCEEDED: ${evalResult.totalUnmeasured} > ${evalResult.maxUnmeasured}`);
      console.log('List of unmeasured cells:');
      for (const d of evalResult.darkCells) {
        console.log(`  - ${d.seq} (vault: ${d.vault ? 'ON' : 'off'}, fault: ${d.fault}, step: ${d.step}): not measured ${d.missing.join(', ')}`);
      }
    }

    return evalResult;
  } finally {
    if (fs.existsSync(tmpOut)) {
      try { fs.unlinkSync(tmpOut); } catch {}
    }
    // Clean default file if created
    const defaultOut = path.join(rootDir, '.postulates-results.json');
    if (fs.existsSync(defaultOut)) {
      try { fs.unlinkSync(defaultOut); } catch {}
    }
  }
}

export async function runDatabaseChecks(client, { logger = console.log } = {}) {
  let totalViolations = 0;
  let skipped = 0;
  const logs = [];
  const log = (msg = '') => {
    logs.push(msg);
    if (logger) logger(msg);
  };

  // 1. Cyrillic text sweep across encrypted columns
  log('\n--- 1. Cyrillic text sweep (detects readable Russian in cloud) ---');
  log("SQL Query: SELECT count(*) FROM <table> WHERE <val>::text ~ '[А-Яа-яЁё]'");
  for (const entry of ENC_COLS) {
    const { table, col } = entry;
    const from = entryFrom(table, col, ENC_COLS);
    const val = entryVal(table, col, ENC_COLS);
    const fixtureCond = getFixtureFilter(table);
    const whereCond = fixtureCond ? `${fixtureCond} AND ` : '';
    const q = `SELECT count(*)::int AS cnt FROM ${from} WHERE ${whereCond}${val} IS NOT NULL AND ${val}::text <> '' AND ${val}::text ~ '[А-Яа-яЁё]'`;
    try {
      const res = await client.query(q);
      const cnt = res.rows[0]?.cnt || 0;
      if (cnt > 0) {
        log(`  [FAIL] ${table}.${col}: ${cnt} rows carrying readable Cyrillic text`);
        totalViolations += cnt;
      } else {
        log(`  [OK]   ${table}.${col}: 0 readable rows`);
      }
    } catch (err) {
      skipped++;
      log(`  [SKIP] ${table}.${col}: ${err.message}`);
    }
  }

  // 2. Base64 shape check in encrypted columns
  log('\n--- 2. Base64 shape check (verifies ciphertext structure) ---');
  log("SQL Query: SELECT count(*) FROM <table> WHERE <flag> AND <val> IS NOT NULL AND <val> <> '' AND NOT (<val> ~ '^[A-Za-z0-9+/=]+$' AND length(<val>) % 4 = 0)");
  for (const entry of ENC_COLS) {
    const { table, col } = entry;
    const from = entryFrom(table, col, ENC_COLS);
    const flag = entryFlag(table, col, ENC_COLS);
    const val = entryVal(table, col, ENC_COLS);
    const fixtureCond = getFixtureFilter(table);
    const whereCond = fixtureCond ? `${fixtureCond} AND ` : '';
    const q = `SELECT count(*)::int AS cnt FROM ${from} WHERE ${whereCond}${flag} AND ${val} IS NOT NULL AND ${val}::text <> '' AND NOT (${val}::text ~ '^[A-Za-z0-9+/=]+$' AND length(${val}::text) % 4 = 0)`;
    try {
      const res = await client.query(q);
      const cnt = res.rows[0]?.cnt || 0;
      if (cnt > 0) {
        log(`  [FAIL] ${table}.${col}: ${cnt} rows with non-base64 ciphertext`);
        totalViolations += cnt;
      } else {
        log(`  [OK]   ${table}.${col}: 0 non-base64 rows`);
      }
    } catch (err) {
      skipped++;
      log(`  [SKIP] ${table}.${col}: ${err.message}`);
    }
  }

  // 3. Whitespace check (ciphertext never contains spaces)
  log('\n--- 3. Whitespace check (ciphertext never contains spaces) ---');
  log("SQL Query: SELECT count(*) FROM <table> WHERE <flag> AND <val> IS NOT NULL AND <val>::text ~ '\\s'");
  for (const entry of ENC_COLS) {
    const { table, col } = entry;
    const from = entryFrom(table, col, ENC_COLS);
    const flag = entryFlag(table, col, ENC_COLS);
    const val = entryVal(table, col, ENC_COLS);
    const fixtureCond = getFixtureFilter(table);
    const whereCond = fixtureCond ? `${fixtureCond} AND ` : '';
    const q = `SELECT count(*)::int AS cnt FROM ${from} WHERE ${whereCond}${flag} AND ${val} IS NOT NULL AND ${val}::text ~ '\\s'`;
    try {
      const res = await client.query(q);
      const cnt = res.rows[0]?.cnt || 0;
      if (cnt > 0) {
        log(`  [FAIL] ${table}.${col}: ${cnt} rows containing whitespace`);
        totalViolations += cnt;
      } else {
        log(`  [OK]   ${table}.${col}: 0 rows with whitespace`);
      }
    } catch (err) {
      skipped++;
      log(`  [SKIP] ${table}.${col}: ${err.message}`);
    }
  }

  // 4. _encrypted census
  log('\n--- 4. _encrypted census (all rows in encrypted tables must have _encrypted = true) ---');
  log('SQL Query: SELECT count(*) FROM public.%I WHERE <unencrypted>');
  for (const { table, unencrypted } of CENSUS_TABLES) {
    const q = `SELECT count(*)::int AS cnt FROM public."${table}" WHERE ${unencrypted}`;
    try {
      const res = await client.query(q);
      const cnt = res.rows[0]?.cnt || 0;
      if (cnt > 0) {
        // Незашифрованная строка в таблице, которая обязана быть зашифрованной,
        // — это нарушение постулата 2, а не справка к сведению.
        log(`  [FAIL] ${table}: ${cnt} unencrypted rows`);
        totalViolations += cnt;
      } else {
        log(`  [OK]   ${table}: 0 unencrypted rows`);
      }
    } catch (err) {
      skipped++;
      log(`  [SKIP] ${table}: ${err.message}`);
    }
  }

  // 5. Инвариант версий (BETA-5). В rls.test.sql он проверяет только опрятность
  // собственных данных: там не исполняется код приложения. Здесь — живая база,
  // строки в которой писал продукт, и это единственное место, где расхождение
  // счётчика с фактом что-то значит. Именно так нашлись те две строки.
  log('\n--- 5. Version counter invariant (current_version must equal max(version)) ---');
  log("SQL Query: SELECT count(*) FROM documents d JOIN (SELECT document_uuid, max(version) ...) sub ON d.uuid = sub.document_uuid WHERE d.current_version <> sub.max_v");
  try {
    const res = await client.query(`
      SELECT count(*)::int AS cnt
        FROM public.documents d
        JOIN (SELECT document_uuid, max(version) AS max_v FROM public.versions GROUP BY document_uuid) sub
          ON d.uuid = sub.document_uuid
       WHERE d.user_id::text NOT LIKE '${RESERVED_FIXTURE_UID_PREFIX}%' AND d.deleted_at IS NULL AND d.current_version <> sub.max_v`);
    const cnt = res.rows[0]?.cnt || 0;
    if (cnt > 0) {
      log(`  [FAIL] documents: ${cnt} rows whose current_version disagrees with their versions`);
      totalViolations += cnt;
    } else {
      log('  [OK]   documents: 0 rows with a lagging version counter');
    }
  } catch (err) {
    skipped++;
    log(`  [SKIP] documents invariant: ${err.message}`);
  }

  return { success: totalViolations === 0, checked: true, totalViolations, skipped, logs };
}

export async function runDatabaseSweep(databaseUrl, options = {}) {
  console.log('\n================================================================');
  console.log('PART 2: DATABASE PRIVACY SWEEP (ZERO ROW CONTENT PRINTED)');
  console.log('================================================================');

  if (!databaseUrl) {
    console.log('DATABASE_URL not set.');
    console.log('Skipping live database sweep (in-memory Postgres verified in Part 1).');
    console.log('To run against a live database: DATABASE_URL=postgres://... npm run postulates\n');
    return { success: true, checked: false };
  }

  let pg;
  try {
    pg = await import('pg');
  } catch (err) {
    console.error('Failed to load pg module:', err.message);
    return { success: false, checked: true, error: err.message };
  }

  const Client = pg.default?.Client || pg.Client;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    return await runDatabaseChecks(client, options);
  } finally {
    await client.end();
  }
}

export async function main() {
  // N-76: --help / -h — печатаем справку и выходим 0 (не запускаем матрицу).
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  const maxUnmeasuredArg = process.argv.find(a => a.startsWith('--max-unmeasured'));
  let maxUnmeasured = null;
  if (maxUnmeasuredArg) {
    if (maxUnmeasuredArg.includes('=')) {
      maxUnmeasured = parseInt(maxUnmeasuredArg.split('=')[1], 10);
    } else {
      const idx = process.argv.indexOf(maxUnmeasuredArg);
      if (idx !== -1 && process.argv[idx + 1] !== undefined) {
        maxUnmeasured = parseInt(process.argv[idx + 1], 10);
      }
    }
  }

  const matrixRes = await runLifecycleMatrix(maxUnmeasured);
  // EA-7: --require-db — пропущенный обход базы или пропущенная в нём проверка
  // считаются провалом, а не «не запускали».
  const requireDb = process.argv.includes('--require-db');
  const dbResRaw = await runDatabaseSweep(process.env.DATABASE_URL);
  const dbRes = requireDb && (!dbResRaw.checked || dbResRaw.skipped > 0)
    ? { ...dbResRaw, success: false, totalViolations: dbResRaw.totalViolations ?? 0 }
    : dbResRaw;

  console.log('\n================================================================');
  console.log('VERDICT');
  console.log('================================================================');

  const passed = matrixRes.success && dbRes.success;

  const POSTULATES = [
    'P1  nothing written locally is lost',
    'P2  nothing leaves for the cloud unencrypted',
    'P3  AI is the one disclosed exception',
    'P4  saved, encrypted, synchronised, nothing leaked',
  ];
  if (matrixRes.tally) {
    console.log(`Measured across ${matrixRes.totalCells} runs (sequence x fault x vault state):\n`);
    matrixRes.tally.forEach((c, i) => {
      console.log(
        `  ${POSTULATES[i].padEnd(52)} held ${String(c.held).padStart(3)}` +
        `   not measured ${String(c.notMeasured).padStart(3)}` +
        `   violated ${c.violated}`
      );
    });
    console.log('');
    console.log('  "not measured" is not "held". P2 is measurable only with the vault on,');
    console.log('  and P4 only when the legs it is built from were measured.');
    console.log('');
  }
  console.log(dbRes.checked
    ? `  Database sweep: RAN${dbRes.skipped ? ` — ${dbRes.skipped} check(s) SKIPPED, read them above` : ' — every check executed'}`
    : '  Database sweep: NOT RUN — set DATABASE_URL to include it.');
  console.log('');

  if (passed) {
    console.log('RESULT: NO VIOLATIONS FOUND');
    console.log(dbRes.checked
      ? 'Every postulate that could be measured held, in the matrix and in the database.'
      : 'Every postulate that could be measured held in the matrix. The database was not scanned.');
    process.exit(0);
  } else {
    console.log('RESULT: FAILED');
    if (!matrixRes.success) {
      console.log(`  - Part 1 (Matrix runner) failed: ${matrixRes.violations.length} violation(s), ${matrixRes.brokenCells} broken cell(s)` +
        (matrixRes.unmeasured.length ? `, never measured: P${matrixRes.unmeasured.join(', P')}` : '') +
        (matrixRes.unmeasuredExceeded ? `, unmeasured limit exceeded: ${matrixRes.totalUnmeasured} > ${matrixRes.maxUnmeasured}` : '') +
        (matrixRes.totalCells === 0 ? ', empty matrix' : ''));
    }
    if (!dbRes.success) {
      console.log(!dbRes.checked
        ? '  - Part 2 (Database sweep) required (--require-db) but NOT RUN — set DATABASE_URL'
        : `  - Part 2 (Database sweep) failed: ${dbRes.totalViolations} violation(s), ${dbRes.skipped ?? 0} skipped check(s)`);
    }
    process.exit(1);
  }
}

const isMainModule = Boolean(
  process.argv[1] &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
   process.argv[1].endsWith('postulates.mjs'))
);

if (isMainModule) {
  main().catch(err => {
    console.error('\nFatal error executing postulates script:', err);
    process.exit(1);
  });
}
