import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  evaluateMatrixResults,
  runDatabaseChecks,
  ENC_COLS,
  CENSUS_TABLES,
  VAULT_ON_SQL,
} from '../../../../scripts/postulates.mjs';

const rootDir = path.resolve(__dirname, '../../../..');
const postulatesScript = path.join(rootDir, 'scripts/postulates.mjs');

function tail(text: string | null | undefined, lines = 80): string {
  if (!text) return '';
  const arr = text.trimEnd().split('\n');
  return arr.length <= lines ? arr.join('\n') : arr.slice(-lines).join('\n');
}

// У spawnSync три канала отказа: код, сигнал и error (тайм-аут, ENOENT). Под
// нагрузкой полного прогона ребёнка убивал тайм-аут, а сообщение печатало
// только stdout с «NO VIOLATIONS FOUND» — причину не видел никто (F-4, R3 §4.3).
function why(res: ReturnType<typeof spawnSync>): string {
  return [
    res.error ? `spawn error: ${res.error.message}` : '',
    res.signal ? `signal: ${res.signal}` : '',
    tail(res.stdout as string | null),
    tail(res.stderr as string | null),
  ].filter(Boolean).join('\n');
}

// Обход матрицы спокойно — 2–3 с, под нагрузкой полного прогона замерено
// 71–218 с (аудит R3 §4.3). Потолок — с запасом над худшим замером.
const MATRIX_SPAWN_TIMEOUT_MS = 300_000;

describe('Postulates Command Suite (BETA-8 / POST-4)', () => {
  it('scripts/postulates.mjs runs cleanly and passes all postulates', () => {
    // N-3: этот тест про матрицу без базы; живой обход базы — отдельный запуск
    // с DATABASE_URL, поэтому переменную окружения сюда не пропускаем.
    // Число только уменьшается. Факт: 0 применимых не измеренных ячеек;
    // P2/P4 без сейфа неприменимы и не считаются.
    const { DATABASE_URL: _db, ...env } = process.env;
    const res = spawnSync('node', [postulatesScript, '--max-unmeasured', '0'], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: MATRIX_SPAWN_TIMEOUT_MS,
      env,
    });

    expect(res.status, why(res)).toBe(0);
    expect(res.stdout).toContain('RESULT: NO VIOLATIONS FOUND');
    expect(res.stdout).toContain('PART 1: LIFECYCLE MATRIX RUNNER');
    expect(res.stdout).toContain('PART 2: DATABASE PRIVACY SWEEP');
    // Вердикт обязан отчитаться о ПОКРЫТИИ, а не объявлять «все четыре держатся»
    // поверх матрицы, где сорок процентов ячеек не измерены: читатель смотрит на
    // последнюю строку, а не на шестьдесят шесть предыдущих.
    expect(res.stdout).toContain('not measured');
    expect(res.stdout, 'счёт по каждому постулату отдельно').toMatch(/P2 .*held +\d+ +not measured +\d+ +violated \d+/);
    // K-8/N-76: вердикт называет применимые ячейки применимыми и печатает
    // неприменимые слоты отдельной строкой, а не прячет их в «not measured».
    expect(res.stdout, 'вердикт говорит про applicable cells').toContain('applicable cells');
    expect(res.stdout, 'неприменимые слоты посчитаны отдельно').toMatch(/not-applicable slots \(P2\/P4 with the vault off\): \d+/);
    expect(res.stdout, 'пропущенный обход базы обязан быть назван').toContain('Database sweep: NOT RUN');
    // R5-032: и в самой строке RESULT — её читают, а не сводку выше.
    expect(res.stdout).toContain('RESULT: NO VIOLATIONS FOUND IN THE MATRIX — DATABASE NOT SCANNED');
    expect(res.stdout).not.toContain('All four postulates hold');
  }, MATRIX_SPAWN_TIMEOUT_MS + 20_000);

  it('N-76: --help / -h exits 0 and prints usage (does not run the matrix)', () => {
    const { DATABASE_URL: _db, ...env } = process.env;
    for (const flag of ['--help', '-h']) {
      const res = spawnSync('node', [postulatesScript, flag], {
        cwd: rootDir, encoding: 'utf8', timeout: 30000, env,
      });
      expect(res.status, `${flag} should exit 0\n${why(res)}`).toBe(0);
      expect(res.stdout, `${flag} should print Usage`).toContain('Usage: node scripts/postulates.mjs');
      expect(res.stdout, `${flag} should explain --max-unmeasured`).toContain('--max-unmeasured');
      expect(res.stdout, `${flag} should describe cells`).toContain('cells');
      // K-8/N-76: помощь честно говорит, что 0 — про применимые ячейки.
      expect(res.stdout, `${flag} should say applicable cells`).toContain('applicable cells');
      expect(res.stdout, `${flag} should mention the separate not-applicable count`).toContain('printed separately');
      expect(res.stdout, `${flag} should NOT run matrix`).not.toContain('LIFECYCLE MATRIX RUNNER');
    }
  }, 60_000);

  it('scripts/postulates.mjs --max-unmeasured ratchet works (TB-11)', () => {
    const { DATABASE_URL: _db, ...env } = process.env;

    // 1. --max-unmeasured -1: отрицательное — не «жёстче храповик», а мусор
    // во входе. R4-033: раньше -1 парсился в -1 и ронял матрицу честно, но
    // NaN из `--max-unmeasured --require-db` молча выключал храповик —
    // нецелое значение теперь exit 2 до запуска матрицы.
    const resNeg = spawnSync('node', [postulatesScript, '--max-unmeasured', '-1'], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: MATRIX_SPAWN_TIMEOUT_MS,
      env,
    });
    expect(resNeg.status, why(resNeg)).toBe(2);
    expect(resNeg.stderr).toContain('неотрицательное целое');

    // 3. evaluateMatrixResults directly unit test
    const cell1 = {
      sequence: 's1',
      fault: 'none',
      step: 'x',
      vaultEnabled: true,
      p1Held: true,
      p2Held: true,
      p3Held: true,
      p4Held: true,
    };
    const cell2 = {
      sequence: 's2',
      fault: 'none',
      step: 'x',
      vaultEnabled: true,
      p1Held: true,
      p2Held: undefined,
      p3Held: true,
      p4Held: undefined,
    }; // 2 unmeasured total across the run
    expect(evaluateMatrixResults([cell1, cell2], 2).success).toBe(true);
    expect(evaluateMatrixResults([cell1, cell2], 1).success).toBe(false);
    expect(evaluateMatrixResults([cell1, cell2], 1).unmeasuredExceeded).toBe(true);

    // Без сейфа P2 и P4 неприменимы — это не тёмные ячейки; P1 без замера — тёмная.
    const vaultOff = { ...cell2, vaultEnabled: false };
    expect(evaluateMatrixResults([cell1, vaultOff], 0).totalUnmeasured).toBe(0);
    expect(evaluateMatrixResults([cell1, { ...vaultOff, p1Held: undefined }], 0).totalUnmeasured).toBe(1);
    // K-8/N-76: неприменимые слоты считаются отдельным счётом, а не «не измерено».
    expect(evaluateMatrixResults([cell1, vaultOff], 0).totalNotApplicable).toBe(2);

    // N-40: seq9 включает сейф сама — после удачного включения её P2/P4 применимы,
    // хоть ячейка и помечена «без сейфа». При сбое включения — неприменимы.
    const seq9 = { ...cell2, sequence: 'seq9_enable_encryption_sync_restore', vaultEnabled: false, faultFired: 1, told: { status: 'restored' } };
    expect(evaluateMatrixResults([cell1, seq9], 0).totalUnmeasured).toBe(2);
    expect(evaluateMatrixResults([cell1, { ...seq9, told: { status: 'error_thrown' } }], 0).totalUnmeasured).toBe(0);
  }, MATRIX_SPAWN_TIMEOUT_MS + 20_000);

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

  // GT-2: ячейка с fault !== 'none' и faultFired === 0 → провал («fault never fired»).
  it('evaluateMatrixResults fails when fault cell has faultFired=0', () => {
    const allHeld = { sequence: 's', fault: 'none', step: 'x', vaultEnabled: true, p1Held: true, p2Held: true, p3Held: true, p4Held: true };
    const faultCellFired = {
      sequence: 'seq1_write_save_sync',
      fault: 'network_pre',
      step: 'cloud_sync',
      vaultEnabled: false,
      p1Held: true,
      p2Held: undefined,
      p3Held: true,
      p4Held: undefined,
      faultFired: 1,
      notes: [],
    };
    const faultCellNotFired = { ...faultCellFired, fault: 'idb_quota', faultFired: 0 };
    const faultCellUndefined = { ...faultCellFired, fault: 'clock_backwards', faultFired: undefined as unknown as number };

    // Cell with faultFired=1 → treated normally (may still pass)
    const okResult = evaluateMatrixResults([allHeld, faultCellFired]);
    expect(okResult.faultNeverFired).toBe(0);

    // Cell with faultFired=0 → brokenCells++, success=false, violations includes "fault never fired"
    const failResult = evaluateMatrixResults([allHeld, faultCellNotFired]);
    expect(failResult.success).toBe(false);
    expect(failResult.faultNeverFired).toBe(1);
    expect(failResult.brokenCells).toBe(1);
    const noteTexts = failResult.violations.flatMap(v => v.notes);
    expect(noteTexts.some(n => n.includes('fault never fired'))).toBe(true);

    // Cell with faultFired=undefined → same as 0
    const undefinedResult = evaluateMatrixResults([allHeld, faultCellUndefined]);
    expect(undefinedResult.success).toBe(false);
    expect(undefinedResult.faultNeverFired).toBe(1);
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

  // R5-030: без сейфа открытый текст — разрешённый режим аккаунта. Ценз,
  // считавший его нарушением, давал стену ложных FAIL и не отвечал на вопрос
  // «есть ли незашифрованная строка у аккаунта с сейфом». Реальный замер на
  // PG16 с миграциями: 1 утечка vault-on + 1 legacy-пара + 2 vault-off + 1
  // надгробие → старый ценз 5, новый 2 (+ INFO 2).
  it('R5-030: census counts plaintext as a violation only for vault-enabled accounts', async () => {
    const mockQuery = vi.fn(async (sql: string) =>
      sql.includes('vault_off') ? { rows: [{ cnt: 0, vault_off: 7 }] } : { rows: [{ cnt: 0 }] });
    const logs: string[] = [];
    const result = await runDatabaseChecks({ query: mockQuery } as any, { logger: (m: string) => logs.push(m) });

    expect(result.success).toBe(true);
    expect(result.totalViolations).toBe(0);
    expect(logs.join('\n')).toContain('documents: 7 plaintext rows of accounts without a vault');

    const census = mockQuery.mock.calls.map(c => c[0] as string).filter(q => q.includes('vault_off'));
    expect(census).toHaveLength(CENSUS_TABLES.length);
    // сейф — это encryption_meta или старая пара salt + ключ (как в EncryptionService)
    expect(VAULT_ON_SQL).toContain('u.encryption_meta IS NOT NULL');
    expect(VAULT_ON_SQL).toContain('u.encryption_salt IS NOT NULL AND u.encrypted_data_key IS NOT NULL');
    for (const q of census) expect(q).toContain(`count(*) FILTER (WHERE ${VAULT_ON_SQL})::int AS cnt`);
    // надгробие обнулено удалением — не строка с содержимым
    expect(census.find(q => q.includes('"documents"'))).toContain('deleted_at IS NULL');
  });

  it('R5-030: plaintext of a vault-enabled account is still a violation', async () => {
    const mockQuery = vi.fn(async (sql: string) =>
      sql.includes('vault_off') && sql.includes('"versions"') ? { rows: [{ cnt: 3, vault_off: 5 }] } : { rows: [{ cnt: 0 }] });
    const logs: string[] = [];
    const result = await runDatabaseChecks({ query: mockQuery } as any, { logger: (m: string) => logs.push(m) });

    expect(result.success).toBe(false);
    expect(result.totalViolations).toBe(3);
    expect(logs.join('\n')).toContain('[FAIL] versions: 3 unencrypted rows of vault-enabled accounts');
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
