import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// S1-16: порядок замков в 0045. Клиентская запись: statement-триггер берёт
// advisory-замок аккаунта (по auth.uid()) ДО блокировок строк, строчный —
// тот же замок по new.user_id. Под сервисной ролью auth.uid() пуст, statement-
// триггер замок не берёт, и запись шла бы «строка → замок» против клиентского
// «замок → строка» — классический 40P01 между двумя сеансами одного аккаунта.
// Проверено 2026-10-22: сервер (api/) эти четыре таблицы не пишет вовсе
// (единственный вызов под сервисным ключом — auth.admin.inviteUserByEmail).
// Храповик держит это: появится запись под сервисной ролью — сначала единый
// порядок (замок до строки, как в lock_sync_rev_stmt) или замок в коде.
const REV_TABLES = ['documents', 'versions', 'drafts', 'local_store_records'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

describe('S1-16: сервер не пишет таблицы с rev под сервисной ролью', () => {
  it('в api/ нет insert/update/upsert в documents/versions/drafts/local_store_records', () => {
    const offenders: string[] = [];
    for (const file of walk('api')) {
      const src = readFileSync(file, 'utf8');
      for (const table of REV_TABLES) {
        // .from('<table>') … .insert/.update/.upsert в одной цепочке, а также
        // сырой SQL insert/update по той же таблице.
        const chain = new RegExp(`\\.from\\(['"\`]${table}['"\`]\\)[\\s\\S]{0,300}?\\.(insert|update|upsert)\\(`, 'g');
        const raw = new RegExp(`\\b(insert\\s+into|update)\\s+(public\\.)?${table}\\b`, 'gi');
        if (chain.test(src) || raw.test(src)) offenders.push(`${file}: ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('тест не пустой: api/ читается', () => {
    expect(walk('api').length).toBeGreaterThan(5);
  });
});
