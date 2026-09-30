import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

describe('AU-3: HSTS и защитные заголовки в nginx', () => {
  const root = process.cwd();
  const snippetPath = join(root, 'deploy/snippets/security-headers.conf');
  const nginxConfPath = join(root, 'deploy/nginx.conf');

  it('snippets/security-headers.conf существует и содержит HSTS и базовые заголовки', () => {
    expect(existsSync(snippetPath), 'файл snippets/security-headers.conf должен существовать').toBe(true);
    const content = readFileSync(snippetPath, 'utf-8');

    expect(content).toContain('Strict-Transport-Security');
    expect(content).toContain('max-age=63072000');
    expect(content).toContain('X-Content-Type-Options');
    expect(content).toContain('nosniff');
    expect(content).toContain('X-Frame-Options');
    expect(content).toContain('DENY');
    expect(content).toContain('Referrer-Policy');
    expect(content).toContain('Permissions-Policy');
    expect(content).toContain('Cross-Origin-Opener-Policy');
    expect(content).toContain('Cross-Origin-Resource-Policy');
  });

  it('deploy/nginx.conf подключает snippets/security-headers.conf на уровне server и во всех location с add_header', () => {
    const nginxConf = readFileSync(nginxConfPath, 'utf-8');

    // На уровне основного сервера
    expect(nginxConf).toContain('include snippets/security-headers.conf;');

    // В каждом location со своими add_header должен быть include
    // Находим все блоки location
    const locationRegex = /location\s+([^{]+)\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    const locationsWithAddHeader: string[] = [];
    const missingInclude: string[] = [];

    while ((match = locationRegex.exec(nginxConf)) !== null) {
      const locPath = match[1]?.trim() ?? '';
      const body = match[2] ?? '';

      if (body.includes('add_header')) {
        locationsWithAddHeader.push(locPath);
        if (!body.includes('include snippets/security-headers.conf;')) {
          missingInclude.push(locPath);
        }
      }
    }

    expect(locationsWithAddHeader.length).toBeGreaterThanOrEqual(3);
    // SB-8: гейт обязан видеть каждый `location = /sw.js` — и в редиректных
    // блоках тоже. Ровно там заголовки и терялись, а проверка их пропускала.
    expect(locationsWithAddHeader.filter((p) => p.includes('/sw.js'))).toHaveLength(3);
    expect(
      missingInclude,
      `В этих location есть add_header, но нет include snippets/security-headers.conf: ${missingInclude.join(', ')}`,
    ).toEqual([]);
  });
});

// M-7: /ready публичный, каждый запрос — SELECT 1 из пула на 10 соединений.
// Фальсификация: убрать limit_req из `location = /ready` — тест краснеет.
describe('M-7: /ready под лимитом запросов', () => {
  it('location = /ready ограничен своей объявленной зоной ready_limit (R5-011)', () => {
    const conf = readFileSync(join(process.cwd(), 'deploy/nginx.conf'), 'utf-8');
    expect(conf).toMatch(/limit_req_zone\s+\S+\s+zone=ready_limit:/);
    const body = conf.match(/location = \/ready \{([^}]+)\}/)?.[1] ?? '';
    expect(body).toContain('proxy_pass');
    expect(body).toMatch(/limit_req zone=ready_limit burst=\d+ nodelay;/);
  });
});
