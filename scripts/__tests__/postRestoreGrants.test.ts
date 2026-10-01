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

const postRestore = new Set(
  readFileSync('deploy/backup/post-restore-grants.sql', 'utf8').split('\n').map(norm).filter(l => /^(grant|revoke)\b/.test(l)),
);

describe('post-restore-grants.sql', () => {
  it('миграции действительно выставляют права (тест не пустой)', () => {
    expect(migrationStatements.length).toBeGreaterThan(5);
  });

  it('каждый grant/revoke — одна строка до «;» (многострочный тест бы не увидел)', () => {
    for (const { f, l } of migrationStatements) expect(l.trim().endsWith(';'), `${f}: ${l.trim()}`).toBe(true);
  });

  it('каждый grant/revoke из миграций есть в post-restore-grants.sql', () => {
    const missing = migrationStatements.filter(({ l }) => !postRestore.has(norm(l))).map(({ f, l }) => `${f}: ${l.trim()}`);
    expect(missing).toEqual([]);
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
