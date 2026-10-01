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

const droppedTables = new Set<string>();
for (const f of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql'))) {
  const content = readFileSync(`${MIGRATIONS}/${f}`, 'utf8');
  const matches = content.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?([a-zA-Z0-9_.,\s]+);/gi);
  for (const m of matches) {
    const rawTables = m[1]?.split(',') ?? [];
    for (const t of rawTables) {
      const cleaned = t.trim().replace(/^public\./i, '').toLowerCase();
      if (cleaned) droppedTables.add(cleaned);
    }
  }
}

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

  it('drill и RESTORE.md применяют файл после pg_restore', () => {
    const drill = readFileSync('deploy/backup/restore-drill.sh', 'utf8');
    const restoreAt = drill.indexOf('pg_restore -U supabase_admin');
    const grantsAt = drill.indexOf('post-restore-grants.sql', restoreAt);
    expect(restoreAt).toBeGreaterThan(-1);
    expect(grantsAt).toBeGreaterThan(restoreAt);
    expect(readFileSync('deploy/backup/RESTORE.md', 'utf8')).toMatch(/pg_restore[\s\S]*post-restore-grants\.sql/);
  });
});
