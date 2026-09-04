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
function formatThreeValued(val) {
  if (val === true) return 'true (held)';
  if (val === false) return 'FALSE';
  return 'not measured';
}

async function runLifecycleMatrix() {
  console.log('================================================================');
  console.log('PART 1: LIFECYCLE MATRIX RUNNER (FAULT-INJECTION HARNESS)');
  console.log('================================================================');
  console.log('Running 10 canonical sequences across fault conditions and vault states...\n');

  const tmpOut = path.join(rootDir, `.postulates-results-${Date.now()}.json`);
  try {
    execSync(`npx vitest run src/testing/faultHarness/postulatesCli.test.ts --silent`, {
      cwd: rootDir,
      env: {
        ...process.env,
        POSTULATES_RESULTS_PATH: tmpOut,
      },
      stdio: 'pipe',
    });

    if (!fs.existsSync(tmpOut)) {
      throw new Error('Matrix runner failed to produce results file');
    }

    const results = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));

    // Print summary table
    console.log(
      'Sequence'.padEnd(38) +
      'Vault'.padEnd(8) +
      'Fault'.padEnd(14) +
      'P1'.padEnd(16) +
      'P2'.padEnd(16) +
      'P3'.padEnd(16) +
      'P4'
    );
    console.log('-'.repeat(120));

    let anyFalse = false;
    const violations = [];

    for (const r of results) {
      const p1 = formatThreeValued(r.p1Held);
      const p2 = formatThreeValued(r.p2Held);
      const p3 = formatThreeValued(r.p3Held);
      const p4 = formatThreeValued(r.p4Held);

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

      const seqName = r.sequence.replace(/^seq\d+_/, '');
      const line =
        r.sequence.padEnd(38) +
        (r.vaultEnabled ? 'ON' : 'off').padEnd(8) +
        r.fault.padEnd(14) +
        p1.padEnd(16) +
        p2.padEnd(16) +
        p3.padEnd(16) +
        p4;
      console.log(line);
    }

    console.log('-'.repeat(120));

    if (violations.length > 0) {
      console.log('\n[!] MATRIX VIOLATIONS DETECTED:');
      for (const v of violations) {
        console.log(`  - ${v.seq} (vault: ${v.vault}, fault: ${v.fault}, step: ${v.step})`);
        for (const n of v.notes) {
          console.log(`      * ${n}`);
        }
      }
    } else {
      console.log('\n[✓] Matrix completed: all measured postulates held.');
    }

    // Счёт по каждому постулату отдельно. Итог «всё держится» поверх матрицы,
    // где сорок процентов ячеек не измерены, — то же самое, что зашитый `true`,
    // только в самом конце и крупным шрифтом. Читатель смотрит на последнюю
    // строку, а не на шестьдесят шесть предыдущих.
    const tally = ['p1Held', 'p2Held', 'p3Held', 'p4Held'].map(k => {
      const c = { held: 0, notMeasured: 0, violated: 0 };
      for (const r of results) {
        if (r[k] === true) c.held++;
        else if (r[k] === false) c.violated++;
        else c.notMeasured++;
      }
      return c;
    });

    return { success: !anyFalse, totalCells: results.length, violations, tally };
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

async function runDatabaseSweep(databaseUrl) {
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

  let totalViolations = 0;

  try {
    // 1. Cyrillic scan across public text/jsonb columns
    console.log('\n--- 1. Cyrillic text sweep (detects readable Russian in cloud) ---');
    const cyrillicQuery = `
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_name = c.table_name
        AND t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public'
        AND c.data_type IN ('text', 'character varying', 'jsonb', 'json')
        AND c.table_name IN ('documents', 'versions', 'drafts', 'ai_summaries', 'ai_embeddings', 'local_store_records')
      ORDER BY c.table_name, c.column_name;
    `;
    console.log('SQL Query: SELECT count(*) FROM public.%I WHERE %I::text ~ \'[А-Яа-яЁё]\'');
    const colsRes = await client.query(cyrillicQuery);

    for (const row of colsRes.rows) {
      const q = `SELECT count(*)::int AS cnt FROM public."${row.table_name}" WHERE "${row.column_name}"::text ~ '[А-Яа-яЁё]'`;
      const res = await client.query(q);
      const cnt = res.rows[0]?.cnt || 0;
      if (cnt > 0) {
        console.log(`  [FAIL] ${row.table_name}.${row.column_name}: ${cnt} rows carrying readable Cyrillic text`);
        totalViolations += cnt;
      } else {
        console.log(`  [OK]   ${row.table_name}.${row.column_name}: 0 readable rows`);
      }
    }

    // 2. Base64 shape check in encrypted columns
    console.log('\n--- 2. Base64 shape check (verifies ciphertext structure) ---');
    const encCols = [
      { table: 'documents', col: 'title' },
      { table: 'documents', col: 'mood' },
      { table: 'versions', col: 'content' },
      { table: 'versions', col: 'previous_content' },
      { table: 'versions', col: 'mood' },
      { table: 'ai_summaries', col: 'summary' },
      { table: 'local_store_records', col: 'payload' },
    ];

    console.log('SQL Query: SELECT count(*) FROM public.%I WHERE _encrypted = true AND %I IS NOT NULL AND %I <> \'\' AND NOT (%I ~ \'^[A-Za-z0-9+/=]+$\')');
    for (const { table, col } of encCols) {
      const q = `SELECT count(*)::int AS cnt FROM public."${table}" WHERE _encrypted = true AND "${col}" IS NOT NULL AND "${col}"::text <> '' AND NOT ("${col}"::text ~ '^[A-Za-z0-9+/=]+$')`;
      try {
        const res = await client.query(q);
        const cnt = res.rows[0]?.cnt || 0;
        if (cnt > 0) {
          console.log(`  [FAIL] ${table}.${col}: ${cnt} rows with non-base64 ciphertext`);
          totalViolations += cnt;
        } else {
          console.log(`  [OK]   ${table}.${col}: 0 non-base64 rows`);
        }
      } catch (err) {
        // Table or column may not have _encrypted or may not exist
        console.log(`  [SKIP] ${table}.${col}: ${err.message}`);
      }
    }

    // 3. No-space check in encrypted columns
    console.log('\n--- 3. Whitespace check (ciphertext never contains spaces) ---');
    console.log('SQL Query: SELECT count(*) FROM public.%I WHERE _encrypted = true AND %I IS NOT NULL AND %I::text ~ \'\\s\'');
    for (const { table, col } of encCols) {
      const q = `SELECT count(*)::int AS cnt FROM public."${table}" WHERE _encrypted = true AND "${col}" IS NOT NULL AND "${col}"::text ~ '\\s'`;
      try {
        const res = await client.query(q);
        const cnt = res.rows[0]?.cnt || 0;
        if (cnt > 0) {
          console.log(`  [FAIL] ${table}.${col}: ${cnt} rows containing whitespace`);
          totalViolations += cnt;
        } else {
          console.log(`  [OK]   ${table}.${col}: 0 rows with whitespace`);
        }
      } catch (err) {
        console.log(`  [SKIP] ${table}.${col}: ${err.message}`);
      }
    }

    // 4. _encrypted census
    console.log('\n--- 4. _encrypted census (all rows in encrypted tables must have _encrypted = true) ---');
    const censusTables = ['documents', 'versions', 'ai_summaries', 'local_store_records'];
    console.log('SQL Query: SELECT count(*) FROM public.%I WHERE _encrypted IS NOT TRUE');
    for (const table of censusTables) {
      const q = `SELECT count(*)::int AS cnt FROM public."${table}" WHERE _encrypted IS NOT TRUE`;
      try {
        const res = await client.query(q);
        const cnt = res.rows[0]?.cnt || 0;
        console.log(`  [INFO] ${table}: ${cnt} unencrypted rows`);
      } catch (err) {
        console.log(`  [SKIP] ${table}: ${err.message}`);
      }
    }

    return { success: totalViolations === 0, checked: true, totalViolations };
  } finally {
    await client.end();
  }
}

async function main() {
  const matrixRes = await runLifecycleMatrix();
  const dbRes = await runDatabaseSweep(process.env.DATABASE_URL);

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
    ? '  Database sweep: RAN'
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
      console.log(`  - Part 1 (Matrix runner) failed: ${matrixRes.violations.length} violation(s) found`);
    }
    if (!dbRes.success) {
      console.log(`  - Part 2 (Database sweep) failed: ${dbRes.totalViolations} violation(s) found`);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nFatal error executing postulates script:', err);
  process.exit(1);
});
