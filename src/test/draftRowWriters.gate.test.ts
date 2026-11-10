import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// DW-4 шаг 7: строку `drafts` пишет мутатор. Новое место записи мимо него обходит эпоху и
// владельца, поэтому оно появляется здесь только с названной причиной. Лишняя строка в списке
// тоже красная: снятое исключение не должно оставаться разрешением.
const ALLOWED: Record<string, string> = {
  'core/storage/localDb.ts': 'полная чистка и перенос прежней базы',
  'features/auth/services/localDataInventory.ts': 'чистка чужих данных',
  'features/auth/services/migrateDocuments.ts': 'перенос гостевого черновика в аккаунт',
  'features/settings/services/migrationImport.ts': 'импорт файла, строка без текущей сессии',
  'features/writing/services/WritingDraftService.ts': 'служебные метки rememberCloudSend, в очереди строки',
  'features/writing/services/draftWriter.ts': 'сам мутатор',
};
const WRITE = /\.(?:put|delete)\(\s*['"]drafts['"]|objectStore\(\s*['"]drafts['"]\)|transaction\(\s*\[?[^)\n]*['"]drafts['"][^)\n]*['"]readwrite['"]|queueWrite\(\s*['"]drafts['"]/;
const SRC = join(process.cwd(), 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'testing' ? [] : sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('запись строки drafts', () => {
  it('идёт только через названные места', () => {
    const found = sources(SRC)
      .filter(p => WRITE.test(readFileSync(p, 'utf-8')))
      .map(p => relative(SRC, p).split(sep).join('/'))
      .sort();
    expect(found).toEqual(Object.keys(ALLOWED).sort());
  });
});
