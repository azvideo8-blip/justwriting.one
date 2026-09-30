import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type Server, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  apiNoTokenErrors,
  checkChatStreamRefund,
  checkHostAndSwHeaders,
  countRawHeader,
  errorCodeFromBody,
  foreignHostRedirectErrors,
  swContentTypeErrors,
} from '../post-deploy-smoke';

async function serve(handler: RequestListener): Promise<{ server: Server; base: string }> {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

let server: Server | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (server) await new Promise((r) => server!.close(r));
  server = null;
});

// M-2: не-200 от /api/chat (403 согласия, 429 лимитов, 502/504) — не провал
// выкатки: провал поднимал откат здоровой службы. Но и не «слот возвращён».
// Фальсификация: вернуть reject на не-200 — errors не пуст, тест краснеет;
// убрать continue — печатается «✅ … слот возвращён», тест краснеет.
describe('post-deploy smoke: обрыв стрима при не-200', () => {
  it.each([
    [401, 'UNAUTHENTICATED'],
    [429, 'DAILY_LIMIT'],
  ])('%i %s — громкое «не измерено», без ✅ и без ошибки', async (status, code) => {
    vi.stubEnv('SMOKE_JWT_SECRET', 's');
    vi.stubEnv('SMOKE_UID', 'u');
    ({ server } = await serve((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/getAIUsageStats') {
        res.end(JSON.stringify({ result: { events: [{ used: 3 }] } }));
      } else {
        res.statusCode = status;
        res.end(JSON.stringify({ error: { code, message: code } }));
      }
    }));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/`;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const errors = await checkChatStreamRefund(base);

    expect(errors).toEqual([]);
    expect(log.mock.calls.flat().join('\n')).not.toContain('✅');
    const warned = warn.mock.calls.flat().join('\n');
    expect(warned).toContain(`не измерено: ${status} ${code}`);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('код ошибки из тела sendError; не-JSON — пусто', () => {
    expect(errorCodeFromBody('{"error":{"code":"AI_CONSENT_REQUIRED"}}')).toBe('AI_CONSENT_REQUIRED');
    expect(errorCodeFromBody('<html>502</html>')).toBe('');
    expect(errorCodeFromBody('null')).toBe('');
  });
});

// M-9 (L-7): приёмка L-7 — чужой Host на :80 не отражается в Location, sw.js
// отдаёт ровно один content-type. fetch склеил бы дубли в «a, b», поэтому
// считаем по rawHeaders.
// Фальсификация: countRawHeader → `rawHeaders.includes(name) ? 1 : 0` или
// startsWith(origin) без «/» — краснеют тесты ниже.
describe('post-deploy smoke: чужой Host и content-type у sw.js', () => {
  it('считает дубли заголовка без учёта регистра', () => {
    expect(countRawHeader(['Content-Type', 'a', 'X', 'y', 'content-type', 'b'], 'content-type')).toBe(2);
    expect(countRawHeader(['Content-Type', 'a'], 'content-type')).toBe(1);
    expect(countRawHeader([], 'content-type')).toBe(0);
  });

  it('редирект только на канонический адрес', () => {
    const o = 'https://justwriting.ru';
    expect(foreignHostRedirectErrors(301, 'https://justwriting.ru/p', o)).toEqual([]);
    expect(foreignHostRedirectErrors(301, 'https://evil.example.com/p', o)).toHaveLength(1);
    expect(foreignHostRedirectErrors(301, 'https://justwriting.ru.evil.example.com/p', o)).toHaveLength(1);
    expect(foreignHostRedirectErrors(301, undefined, o)).toHaveLength(1);
    expect(foreignHostRedirectErrors(200, 'https://justwriting.ru/p', o)).toHaveLength(1);
  });

  it('sw.js: один content-type — ок, два или ноль — ошибка', () => {
    expect(swContentTypeErrors(200, ['Content-Type', 'text/javascript'])).toEqual([]);
    expect(swContentTypeErrors(200, ['Content-Type', 'a', 'Content-Type', 'b'])).toHaveLength(1);
    expect(swContentTypeErrors(200, [])).toHaveLength(1);
    expect(swContentTypeErrors(404, ['Content-Type', 'a'])).toHaveLength(1);
  });

  it('на проводе: исправный сервер проходит', async () => {
    let base = '';
    ({ server, base } = await serve((req, res) => {
      if (req.url === '/p') {
        res.writeHead(301, { Location: `${base}p` }).end();
      } else {
        res.writeHead(200, { 'Content-Type': 'text/javascript' }).end('//');
      }
    }));
    expect(await checkHostAndSwHeaders(base, 5_000)).toEqual([]);
  });

  it('на проводе: Host в Location и двойной content-type ловятся', async () => {
    ({ server } = await serve((req, res) => {
      if (req.url === '/p') {
        res.writeHead(301, { Location: `http://${req.headers.host}/p` }).end();
      } else {
        res.setHeader('Content-Type', ['text/javascript', 'application/javascript']);
        res.end('//');
      }
    }));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/`;
    const errors = await checkHostAndSwHeaders(base, 5_000);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('evil.example.com');
    expect(errors[1]).toContain('2 раз');
  });
});

// R5-011: 429 от общего api_limit — «не измерено», а не откат здоровой службы.
// R5-012: извне :80 с чужим Host рвут соединение — обрыв не открытый
// редиректор. Фальсификация: убрать ветку 429 или isNoResponse — краснеет.
describe('post-deploy smoke: не измерено ≠ провал', () => {
  it('401 — ок; 429 — громкое «не измерено»; прочее — провал', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(apiNoTokenErrors(401)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(apiNoTokenErrors(429)).toEqual([]);
    expect(warn.mock.calls.flat().join('\n')).toContain('не измерено: 429');
    for (const s of [200, 403, 502, 503]) expect(apiNoTokenErrors(s)).toHaveLength(1);
  });

  it('на проводе: обрыв на чужом Host — предупреждение, не ошибка', async () => {
    ({ server } = await serve((req, res) => {
      if (req.url === '/p') {
        req.socket.destroy();
      } else {
        res.writeHead(200, { 'Content-Type': 'text/javascript' }).end('//');
      }
    }));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await checkHostAndSwHeaders(base, 5_000)).toEqual([]);
    expect(warn.mock.calls.flat().join('\n')).toContain('не измерено');
  });

  it('на проводе: отказ в соединении на :80 — по-прежнему провал', async () => {
    // Порт без слушателя: ECONNREFUSED — это не «ответа нет», это «:80 лежит».
    ({ server } = await serve(() => {}));
    const port = (server!.address() as AddressInfo).port;
    await new Promise((r) => server!.close(r));
    server = null;
    const errors = await checkHostAndSwHeaders(`http://127.0.0.1:${port}/`, 5_000);
    expect(errors[0]).toContain('с чужим Host');
  });
});
