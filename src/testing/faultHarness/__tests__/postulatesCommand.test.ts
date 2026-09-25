import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  evaluateMatrixResults,
  runDatabaseChecks,
  ENC_COLS,
  CENSUS_TABLES,
} from '../../../../scripts/postulates.mjs';

const rootDir = path.resolve(__dirname, '../../../..');
const postulatesScript = path.join(rootDir, 'scripts/postulates.mjs');

describe('Postulates Command Suite (BETA-8 / POST-4)', () => {
  it('scripts/postulates.mjs runs cleanly and passes all postulates', () => {
    // N-3: этот тест про матрицу без базы; живой обход базы — отдельный запуск
    // с DATABASE_URL, поэтому переменную окружения сюда не пропускаем.
    const { DATABASE_URL: _db, ...env } = process.env;
    const res = spawnSync('node', [postulatesScript], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 60000,
      env,
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain('RESULT: NO VIOLATIONS FOUND');
    expect(res.stdout).toContain('PART 1: LIFECYCLE MATRIX RUNNER');
    expect(res.stdout).toContain('PART 2: DATABASE PRIVACY SWEEP');
    // Вердикт обязан отчитаться о ПОКРЫТИИ, а не объявлять «все четыре держатся»
    // поверх матрицы, где сорок процентов ячеек не измерены: читатель смотрит на
    // последнюю строку, а не на шестьдесят шесть предыдущих.
    expect(res.stdout).toContain('not measured');
    expect(res.stdout, 'счёт по каждому постулату отдельно').toMatch(/P2 .*held +\d+ +not measured +\d+ +violated \d+/);
    expect(res.stdout, 'пропущенный обход базы обязан быть назван').toContain('Database sweep: NOT RUN');
    expect(res.stdout).not.toContain('All four postulates hold');
  }, 80000);

  // EA-7: «NO VIOLATIONS» без единого измерения — не зелёный вердикт.
  it('evaluateMatrixResults fails an empty, broken or never-measured matrix', () => {
    expect(evaluateMatrixResults([]).success).toBe(false);
    const allHeld = { sequence: 's', fault: 'none', step: 'x', vaultEnabled: true, p1Held: true, p2Held: true, p3Held: true, p4Held: true };
    expect(evaluateMatrixResults([allHeld]).success).toBe(true);
    expect(evaluateMatrixResults([allHeld, undefined]).success).toBe(false);
    const p2Never = { ...allHeld, p2Held: undefined };
    expect(evaluateMatrixResults([p2Never]).success).toBe(false);
    expect(evaluateMatrixResults([p2Never]).unmeasured).toEqual([2]);
  });

  it('scripts/postulates.mjs evaluateMatrixResults flags violations (POST-4 falsification)', () => {
    const brokenResults = [
      {
        sequence: 'seq1_write_save_sync',
        fault: 'none',
        step: 'sync_cloud',
        vaultEnabled: true,
        told: { status: 'synced_to_cloud', cloudSynced: true },
        device: { documentExists: true, versionsCount: 1, queueTasks: [] },
        postgres: { documentExists: true, versionsCount: 1 },
        p1Held: true,
        p2Held: false, // VIOLATION
        p3Held: true,
        p4Held: false,
        notes: ['SIMULATED_PLAINTEXT_LEAK'],
      },
    ];

    const evalResult = evaluateMatrixResults(brokenResults);

    expect(evalResult.success).toBe(false);
    expect(evalResult.violations).toHaveLength(1);
    expect(evalResult.violations[0]?.seq).toBe('seq1_write_save_sync');
    expect(evalResult.violations[0]?.notes).toContain('SIMULATED_PLAINTEXT_LEAK');
    expect(evalResult.tally[1]?.violated).toBe(1);
  });

  it('database privacy sweep executes real queries and prints zero row content (POST-4 canary check)', async () => {
    const CANARY_STRING = 'SECRET_CANARY_DO_NOT_LEAK_CONFIDENTIAL_12345';

    // Mock client matching Part 2 of scripts/postulates.mjs
    const mockQuery = vi.fn().mockImplementation(async (sql: string) => {
      // 1. Count queries return 1 to trigger violation branches
      if (sql.includes('count(*)')) {
        return { rows: [{ cnt: 1 }] };
      }
      // If someone attempted to SELECT row content, return canary
      return { rows: [{ content: CANARY_STRING, title: CANARY_STRING }] };
    });

    const capturedLogs: string[] = [];
    const result = await runDatabaseChecks({ query: mockQuery } as any, {
      logger: (msg: string) => capturedLogs.push(msg),
    });

    const output = capturedLogs.join('\n');

    // 1. All violations should be detected based on the mocked counts
    expect(result.success).toBe(false);
    expect(result.totalViolations).toBeGreaterThan(0);

    // 2. Output must contain count and table info for checked columns (including POST-3 additions)
    expect(output).toContain('documents.title');
    expect(output).toContain('ai_summaries.tone');
    expect(output).toContain('ai_embeddings.chunk_texts_json');
    expect(output).toContain('users.labels.name');
    expect(output).toContain('drafts: 1 unencrypted rows');
    expect(output).toContain('1 rows');

    // 3. Output MUST NEVER contain the canary string content
    expect(output).not.toContain(CANARY_STRING);

    // 4. Falsification check: if output had leaked the row content, the test would fail
    const leakyOutput = `${output}\nLEAKED: ${CANARY_STRING}`;
    expect(leakyOutput).toContain(CANARY_STRING);
  });

  it('database privacy sweep catches all 5 audit probe leak scenarios (POST-3 Task 4)', async () => {
    // Probes from audit report:
    // 1. versions.content (Cyrillic leak)
    // 2. ai_summaries.tone (plaintext English, _encrypted=true)
    // 3. users.labels.name (Cyrillic plaintext 'Практика6')
    // 4. drafts.content (unencrypted draft, _encrypted=false)
    // 5. ai_embeddings.chunk_texts_json (plaintext English)

    const probes = [
      {
        name: 'versions.content (Cyrillic)',
        table: 'versions',
        col: 'content',
        matcher: (sql: string) => sql.includes('[А-Яа-яЁё]') && sql.includes('"versions"') && sql.includes('"content"'),
      },
      {
        name: 'ai_summaries.tone (English plaintext)',
        table: 'ai_summaries',
        col: 'tone',
        matcher: (sql: string) => sql.includes('NOT (') && sql.includes('"ai_summaries"') && sql.includes('"tone"'),
      },
      {
        name: 'users.labels.name (Cyrillic Практика6)',
        table: 'users',
        col: 'labels.name',
        matcher: (sql: string) => sql.includes('[А-Яа-яЁё]') && sql.includes('labels'),
      },
      {
        name: 'drafts (unencrypted census)',
        table: 'drafts',
        matcher: (sql: string) => sql.includes('"drafts"') && sql.includes('_encrypted IS NOT TRUE'),
      },
      {
        name: 'ai_embeddings.chunk_texts_json (English plaintext)',
        table: 'ai_embeddings',
        col: 'chunk_texts_json',
        matcher: (sql: string) => sql.includes('NOT (') && sql.includes('"ai_embeddings"') && sql.includes('"chunk_texts_json"'),
      },
    ];

    for (const probe of probes) {
      const mockQuery = vi.fn().mockImplementation(async (sql: string) => {
        if (probe.matcher(sql)) {
          return { rows: [{ cnt: 1 }] };
        }
        return { rows: [{ cnt: 0 }] };
      });

      const capturedLogs: string[] = [];
      const result = await runDatabaseChecks({ query: mockQuery } as any, {
        logger: (msg: string) => capturedLogs.push(msg),
      });

      expect(result.success, `Probe ${probe.name} must fail the sweep`).toBe(false);
      expect(result.totalViolations, `Probe ${probe.name} must produce at least one violation`).toBeGreaterThan(0);
      const output = capturedLogs.join('\n');
      expect(output).toContain('[FAIL]');
      expect(output).toContain(probe.col ? `${probe.table}.${probe.col}` : `${probe.table}: 1 unencrypted rows`);
    }
  });

  it('ENC_COLS and CENSUS_TABLES contain all required fields from POST-3', () => {
    // POST-3 Task 1 & 2 verification:
    const encColsKeys = ENC_COLS.map(c => `${c.table}.${c.col}`);
    expect(encColsKeys).toContain('ai_summaries.tone');
    expect(encColsKeys).toContain('ai_embeddings.chunk_texts_json');
    expect(encColsKeys).toContain('users.labels.name');
    expect(encColsKeys).toContain('drafts.content');
    expect(encColsKeys).toContain('drafts.title');

    const censusTableNames = CENSUS_TABLES.map(t => t.table);
    expect(censusTableNames).toContain('drafts');
  });
});
