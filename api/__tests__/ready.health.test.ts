// SA-4 (`perimeter-and-records/04`): /ready собирается отдавать наружу сырое
// сообщение ошибки pg и фактический AI_EMBED_BASE_URL. Сообщение pg — это
// «connect ECONNREFUSED 10.0.0.7:5432» или «password authentication failed»,
// т. е. внутренние адреса и форма строки подключения; URL бэкенда — то же
// самое одним полем. /ready наружу не проксируется (deploy/nginx.conf), но
// читается с VPS, а значит не должен содержать того, чего нет в самом файле.
//
// Проверка на ФОРМУ ответа, а не на текст: ответ — JSON, и red-тест обязан
// ловить любое поле, куда утекло содержимое env или message.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const QUERY = vi.hoisted(() => vi.fn());
vi.mock('../db', () => ({ pool: { query: QUERY } }));

// Canary-значения: то, что обязано остаться в env и не появиться в ответе.
const DSN = 'postgresql://supabase_admin:hunter2@10.0.0.7:5432/postgres';
const EMBED_URL = 'http://embed.internal:8080/v1';
const PG_MESSAGE = `connect ECONNREFUSED ${DSN}`;

let saved: Record<string, string | undefined>;

async function ready(port?: number) {
  const mod = await import('../server');
  const server = mod.default;
  await new Promise<void>(r => server.listen(port ?? 0, '127.0.0.1', () => r()));
  const addr = server.address();
  const p = typeof addr === 'object' && addr ? addr.port : 3000;
  const res = await fetch(`http://127.0.0.1:${p}/ready`);
  const body = await res.json() as { status: string; checks: Array<Record<string, unknown>> };
  await new Promise<void>(r => server.close(() => r()));
  return { status: res.status, body };
}

beforeEach(() => {
  saved = {
    DATABASE_URL: process.env.DATABASE_URL,
    AI_EMBED_BASE_URL: process.env.AI_EMBED_BASE_URL,
    AI_BASE_URL: process.env.AI_BASE_URL,
  };
  process.env.DATABASE_URL = DSN;
  process.env.AI_EMBED_BASE_URL = EMBED_URL;
  QUERY.mockReset();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// R5-005: холодный import('../server') и настоящий сокет — под нагрузкой
// первый кейс не укладывался и в 15 с. Бюджет на весь блок, а не на один
// кейс: холодный импорт платит тот, кто запустится первым.
describe('/ready (SA-4)', { timeout: 30_000 }, () => {
  it('не отдаёт наружу ни строку подключения, ни адрес бэкенда, ни message драйвера', async () => {
    QUERY.mockRejectedValue(Object.assign(new Error(PG_MESSAGE), { code: 'ECONNREFUSED' }));
    const { status, body } = await ready();
    const wire = JSON.stringify(body);

    expect(status).toBe(503);
    expect(body.status).toBe('not_ready');
    // Утечки быть не может ни в каком виде: ни прямо, ни percent-encoded.
    for (const secret of [DSN, EMBED_URL, 'hunter2', '10.0.0.7', PG_MESSAGE]) {
      expect(wire).not.toContain(secret);
      expect(wire).not.toContain(encodeURIComponent(secret));
    }
    expect(wire.toLowerCase()).not.toContain('embed.internal');
  });

  it('база описана кодом ошибки и булевым флагом, а не текстом драйвера', async () => {
    QUERY.mockRejectedValue(Object.assign(new Error(PG_MESSAGE), { code: 'ECONNREFUSED' }));
    const { body } = await ready();
    const db = body.checks.find(c => c.name === 'database');

    expect(db?.status).toBe('error');
    expect(db?.ok).toBe(false);
    expect(db?.code).toBe('ECONNREFUSED');
    // Единственный допустимый способ сказать «что-то не так» — код из
    // белого списка. message/stack/error как ключи запрещены вовсе.
    expect(Object.keys(db ?? {})).toEqual(['name', 'status', 'ok', 'code']);
  });

  it('проверка embed не печатает url и различает configured и fallback_default', async () => {
    QUERY.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const configured = await ready();
    const withUrl = configured.body.checks.find(c => c.name === 'ai_embed_base_url');
    expect(withUrl).toEqual({ name: 'ai_embed_base_url', status: 'configured' });

    delete process.env.AI_EMBED_BASE_URL;
    const fallback = await ready();
    expect(fallback.body.checks.find(c => c.name === 'ai_embed_base_url'))
      .toEqual({ name: 'ai_embed_base_url', status: 'fallback_default' });
  });

  it('без DATABASE_URL readiness честно 503 (L-9 / R4-082)', async () => {
    delete process.env.DATABASE_URL;
    QUERY.mockRejectedValue(new Error(PG_MESSAGE));
    const { status, body } = await ready();

    expect(status).toBe(503);
    expect(body.status).toBe('not_ready');
    expect(body.checks.find(c => c.name === 'database')).toEqual({
      name: 'database', status: 'not_configured', ok: false,
    });
    expect(QUERY).not.toHaveBeenCalled();
  });
});
