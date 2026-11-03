import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// DY8-5: клиент читал `VITE_AI_QUERY_EXPANSION`, которую сборка не задаёт ни
// в одном окружении, — ветка расширения запроса была мёртвой во всех выкатках.
// Класс известный (CLAUDE.md §5): «клиент читает VITE_, которой сборка не
// ставит». Гейт: каждая `import.meta.env.VITE_*` в коде клиента — из списка
// ниже, с причиной. Новая переменная — сначала в сборку (deploy.yml), потом сюда.
// Мутация: вернуть чтение `VITE_AI_QUERY_EXPANSION` в aiChatContext.ts — красный.
//
// ponytail: только точечная запись `import.meta.env.VITE_X`; деструктуризация
// и `env['VITE_…']` гейт не увидит — в src их нет.

const KNOWN: Record<string, string> = {
  VITE_SUPABASE_URL: 'задаётся сборкой (секрет в deploy.yml/ci.yml), без неё выкатка падает',
  VITE_SUPABASE_ANON_KEY: 'задаётся сборкой (секрет в deploy.yml/ci.yml), без неё выкатка падает',
  VITE_SITE_URL: 'не задаётся, но читается с запасным значением (SeoHead)',
};

const SRC = join(process.cwd(), 'src');

function clientFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'test' || name === 'testing') continue;
      clientFiles(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe('DY8-5: клиент читает только те VITE_, что знает сборка', () => {
  it('нет чтений неизвестных VITE_-переменных', () => {
    const unknown: string[] = [];
    let seen = 0;
    for (const f of clientFiles(SRC)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/import\.meta\.env\.(VITE_\w+)/g)) {
        seen++;
        if (!(m[1]! in KNOWN)) unknown.push(`${relative(process.cwd(), f).split(sep).join('/')}: ${m[1]}`);
      }
    }
    expect(seen, 'гейт ничего не нашёл — вакуумный').toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });
});
