import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// R7F-007: `/auth/v1/otp`, `/magiclink` и `/resend` наружу не нужны. Под
// публичным anon-ключом они работают и дают оракул существования адреса плюс
// отправку писем сервиса по требованию. Приложение их не зовёт — этот тест
// сторожит и это: если кто-то начнёт пользоваться `/otp`, проверка покраснеет
// и заставит решить, что из трёх закрываний снимать.
const root = process.cwd();
const NGINX = join(root, 'deploy', 'nginx.conf');
const OVERRIDE = join(root, 'deploy', 'supabase-compose.override.yml');

const CLOSED = ['/auth/v1/otp', '/auth/v1/magiclink', '/auth/v1/resend'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

describe('R7F-007: неиспользуемые точки GoTrue закрыты', () => {
  const nginx = readFileSync(NGINX, 'utf8');

  // Ревью 0.9.43: `location =` пропускал вариант со слешем на конце. Проверяем
  // настоящую регулярку из конфига на путях с слешем и без, и порядок: блок
  // обязан стоять раньше общего `^/auth/` (регулярные location — по порядку).
  // Мутация: вернуть `location = /auth/v1/otp` → красный.
  it.each(CLOSED)('%s (и со слешем) отдаёт 404 до проксирования в Kong', path => {
    const blocks = [...nginx.matchAll(/location\s+~\*?\s+(\^\/auth\/v1\/\S+)\s*\{\s*return 404;\s*\}/g)];
    const m = blocks.find(block => /otp/.test(block[1]!));
    expect(m, 'в deploy/nginx.conf нет регулярного location с return 404').not.toBeNull();
    const re = new RegExp(m![1]!, 'i');
    expect(re.test(path)).toBe(true);
    expect(re.test(`${path}/`)).toBe(true);
    expect(re.test('/auth/v1/token')).toBe(false);
    expect(re.test('/auth/v1/verify')).toBe(false);
    expect(nginx.indexOf(m![0])).toBeLessThan(nginx.search(/location\s+~\s+\^\/auth\/\s*\{/));
  });

  it('остальной /auth/ по-прежнему проксируется (иначе сломали бы вход)', () => {
    expect(nginx).toMatch(/location\s+~\s+\^\/auth\/\s*\{[\s\S]{0,400}?proxy_pass http:\/\/supabase_kong;/);
  });

  it('телефонное направление и SMS-autoconfirm выключены в override', () => {
    const yml = readFileSync(OVERRIDE, 'utf8');
    expect(yml).toMatch(/GOTRUE_EXTERNAL_PHONE_ENABLED:\s*"false"/);
    expect(yml).toMatch(/GOTRUE_SMS_AUTOCONFIRM:\s*"false"/);
  });

  it('приложение ни одну из трёх точек не зовёт', () => {
    const banned = /signInWithOtp|auth\/v1\/otp|magiclink|\.resend\(/;
    const hits: string[] = [];
    for (const file of sourceFiles(join(root, 'src'))) {
      if (banned.test(readFileSync(file, 'utf8'))) hits.push(relative(root, file));
    }
    expect(hits, `точек быть не должно, нашлись: ${hits.join(', ')}`).toEqual([]);
  });
});

describe('B-4: админ-API GoTrue закрыт снаружи', () => {
  const nginx = readFileSync(NGINX, 'utf8');
  const m = /location\s+~\s+(\^\/auth\/v1\/admin\(\/\|\$\))\s*\{\s*return 404;\s*\}/.exec(nginx);

  it('^/auth/v1/admin(/|$) → 404, но /auth/v1/adminfoo — нет', () => {
    expect(m, 'нет location для /auth/v1/admin').not.toBeNull();
    const re = new RegExp(m![1]!);
    expect(re.test('/auth/v1/admin')).toBe(true);
    expect(re.test('/auth/v1/admin/')).toBe(true);
    expect(re.test('/auth/v1/adminfoo')).toBe(false);
  });

  it('блок стоит выше общего ^/auth/', () => {
    expect(nginx.indexOf(m![0])).toBeLessThan(nginx.search(/location\s+~\s+\^\/auth\/\s*\{/));
  });
});
