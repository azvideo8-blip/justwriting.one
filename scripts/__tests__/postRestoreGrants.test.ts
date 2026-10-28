// Drill 2026-10-01: восстановление с --no-privileges вернуло anon/authenticated
// права, которые 0034 отозвала, — default privileges образа выдают их заново.
// post-restore-grants.sql возвращает явные права миграций после pg_restore;
// новая миграция с grant/revoke, не попавшая в него, снова тихо откатилась бы
// при восстановлении. Тест держит список полным и сам файл — в процедуре.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = 'supabase/migrations';
const norm = (l: string) => l.trim().replace(/\s+/g, ' ').toLowerCase();

const migrationStatements = readdirSync(MIGRATIONS)
  .filter(f => f.endsWith('.sql'))
  .flatMap(f => readFileSync(`${MIGRATIONS}/${f}`, 'utf8').split('\n').map(l => ({ f, l })))
  .filter(({ l }) => /^\s*(grant|revoke)\b/i.test(l));

// S-44.2: удалённой считается таблица, чей ПОСЛЕДНИЙ DDL — drop. 0022 дропает и
// тут же пересоздаёт ai_bulk_cooldown; фильтр «встречался drop» прятал бы её
// права из проверки.
const lastDdl = new Map<string, string>();
for (const f of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
  const content = readFileSync(`${MIGRATIONS}/${f}`, 'utf8');
  const matches = content.matchAll(/\b(drop|create)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?([a-zA-Z0-9_.,\s]+?)\s*[;(]/gi);
  for (const m of matches) {
    for (const t of m[2]!.split(',')) {
      const cleaned = t.trim().replace(/^public\./i, '').toLowerCase();
      if (cleaned) lastDdl.set(cleaned, m[1]!.toLowerCase());
    }
  }
}
const droppedTables = new Set([...lastDdl].filter(([, ddl]) => ddl === 'drop').map(([t]) => t));

const activeMigrationStatements = migrationStatements.filter(({ l }) => {
  for (const tbl of droppedTables) {
    if (new RegExp(`\\b(public\\.)?${tbl}\\b`, 'i').test(l)) {
      return false;
    }
  }
  return true;
});

const postRestore = new Set(
  readFileSync('deploy/backup/post-restore-grants.sql', 'utf8').split('\n').map(norm).filter(l => /^(grant|revoke)\b/.test(l)),
);

describe('post-restore-grants.sql', () => {
  it('миграции действительно выставляют права (тест не пустой)', () => {
    expect(activeMigrationStatements.length).toBeGreaterThan(5);
  });

  it('каждый grant/revoke — одна строка до «;» (многострочный тест бы не увидел)', () => {
    for (const { f, l } of activeMigrationStatements) expect(l.trim().endsWith(';'), `${f}: ${l.trim()}`).toBe(true);
  });

  it('каждый grant/revoke из действующих миграций есть в post-restore-grants.sql', () => {
    const missing = activeMigrationStatements.filter(({ l }) => !postRestore.has(norm(l))).map(({ f, l }) => `${f}: ${l.trim()}`);
    expect(missing).toEqual([]);
  });

  it('таблица, пересозданная после drop (0022 ai_bulk_cooldown), не считается удалённой; 0036 — считается', () => {
    expect(droppedTables.has('ai_bulk_cooldown')).toBe(false);
    expect(droppedTables.has('anonymized_telemetry')).toBe(true);
    expect(droppedTables.has('telemetry_cooldown')).toBe(true);
  });

  it('post-restore-grants.sql не содержит прав на удалённые таблицы (иначе psql падает при restore)', () => {
    const invalidStatements: string[] = [];
    for (const stmt of postRestore) {
      for (const tbl of droppedTables) {
        if (new RegExp(`\\b(public\\.)?${tbl}\\b`, 'i').test(stmt)) {
          invalidStatements.push(stmt);
        }
      }
    }
    expect(invalidStatements).toEqual([]);
  });

  // S1-15: дамп, снятый до 0045, последовательности не содержит — безусловный
  // revoke на неё ронял весь шаг с ON_ERROR_STOP=1. Страж — psql \if по
  // to_regclass; сама строка revoke остаётся дословной, иначе проверка выше
  // («каждый grant/revoke из миграций есть в файле») её не увидела бы.
  it('S1-15: revoke на sync_rev_seq стоит под стражем to_regclass', () => {
    const grants = readFileSync('deploy/backup/post-restore-grants.sql', 'utf8');
    const revokeAt = grants.indexOf('revoke all on sequence public.sync_rev_seq');
    expect(revokeAt).toBeGreaterThan(-1);
    const guardAt = grants.lastIndexOf('\\if :has_sync_rev_seq', revokeAt);
    const endAt = grants.indexOf('\\endif', revokeAt);
    expect(guardAt).toBeGreaterThan(-1);
    expect(endAt).toBeGreaterThan(revokeAt);
    expect(grants.slice(0, guardAt)).toMatch(/to_regclass\('public\.sync_rev_seq'\)[^\n]*\\gset/);
  });

  // S1-15: восстановление из бэкапа откатывает sync_rev_seq — новые записи
  // получали бы rev ниже курсоров устройств и не приезжали бы никогда.
  it('S1-15: RESTORE.md после грантов прыгает sync_rev_seq вперёд', () => {
    const restore = readFileSync('deploy/backup/RESTORE.md', 'utf8');
    const grantsAt = restore.indexOf('post-restore-grants.sql', restore.indexOf('pg_restore -U supabase_admin'));
    const setvalAt = restore.indexOf("setval('public.sync_rev_seq'", grantsAt);
    expect(setvalAt).toBeGreaterThan(grantsAt);
    expect(restore.slice(setvalAt, setvalAt + 200)).toMatch(/last_value[\s\S]*\+ 1000000000/);
    // Дамп до 0045: последовательности нет — шаг не должен ронять восстановление.
    expect(restore.slice(setvalAt - 300, setvalAt)).toMatch(/to_regclass\('public\.sync_rev_seq'\)/);
  });

  it('drill и RESTORE.md применяют файл после pg_restore', () => {
    const drill = readFileSync('deploy/backup/restore-drill.sh', 'utf8');
    const restoreAt = drill.indexOf('pg_restore -U supabase_admin');
    const grantsAt = drill.indexOf('post-restore-grants.sql', restoreAt);
    expect(restoreAt).toBeGreaterThan(-1);
    expect(grantsAt).toBeGreaterThan(restoreAt);
    expect(readFileSync('deploy/backup/RESTORE.md', 'utf8')).toMatch(/pg_restore[\s\S]*post-restore-grants\.sql/);
  });
});
