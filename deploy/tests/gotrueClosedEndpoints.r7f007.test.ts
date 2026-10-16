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

  it.each(CLOSED)('%s отдаёт 404 до проксирования в Kong', path => {
    const block = new RegExp(`location\\s+=\\s+${path}\\s*\\{\\s*return 404;\\s*\\}`).test(nginx);
    expect(block, `в deploy/nginx.conf должен быть «location = ${path} { return 404; }»`).toBe(true);
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
