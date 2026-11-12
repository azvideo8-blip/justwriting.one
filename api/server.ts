import http from 'node:http';
import { handle as dispatch } from './dispatcher';
import { handleChat } from './chat';
import { MAX_REQUEST_BODY_BYTES } from './ai/pure';
import { rateLimited, clientIp, originOnly } from './cspLimiter';
import { sendError } from './sendError';
import { pool } from './db';
import { safeErrorShape } from '../src/shared/ai/errorShape.js';
import { clientErrorSummary } from './clientError';
import { requireSession } from './auth';

// ── Helpers ────────────────────────────────────────────────────────────
function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// SA-4: код ошибки — единственное, что наружу говорит о причине отказа.
// Формат жёсткий (pg: «28P01», node: «ECONNREFUSED»), поэтому в ответ не
// протаскивается ни один свободный текст драйвера, ни содержимое env.
const ERROR_CODE = /^[A-Za-z0-9_]{2,20}$/;
function safeErrorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && ERROR_CODE.test(code) ? code : 'unknown';
}

// Max payload size: 4MB (note version content schema allows up to 700k chars ~2MB in UTF-8, 4MB provides safety margin)
function readBody(req: http.IncomingMessage, maxBytes = MAX_REQUEST_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        // R4-051: destroy() рвал сокет до ответа — клиент получал EPIPE вместо
        // 413. Чтение останавливается; ответ уходит с Connection: close.
        req.pause();
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// ── Routes ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  void (async () => {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';
  // R4-057: маршруты сверяются по пути без query — '/health?x' не должен
  // падать в 404 или, хуже, в SPA-ответ.
  const path = url.split('?')[0]!;

  // GET /health — liveness: "the process is alive"
  if (method === 'GET' && path === '/health') {
    return json(res, 200, { status: 'ok', uptime: process.uptime() });
  }

  // GET /ready — readiness: "dependencies available, send traffic"
  // POST-5: returns real checks for database connectivity and AI_EMBED_BASE_URL state.
  // SA-4: наружу уходят только коды и флаги. Сообщение драйвера — это
  // «connect ECONNREFUSED 10.0.0.7:5432» или «password authentication failed
  // for user "supabase_admin"»: внутренние адреса и форма строки подключения.
  // /ready проксируется наружу (deploy/nginx.conf, L-7) — его читает внешний
  // монитор, а значит печатать в него env нельзя тем более.
  if (method === 'GET' && path === '/ready') {
    let dbOk = false;
    let dbErrorCode: string | undefined;
    const databaseConfigured = Boolean(process.env.DATABASE_URL);
    const embedRequired = process.env['NODE_ENV'] === 'production';
    if (databaseConfigured) {
      try {
        await pool.query('SELECT 1');
        dbOk = true;
      } catch (err: unknown) {
        dbErrorCode = safeErrorCode(err);
      }
    }

    const checks = [
      {
        name: 'database',
        status: !databaseConfigured ? 'not_configured' : dbOk ? 'ok' : 'error',
        ok: dbOk,
        ...(dbErrorCode ? { code: dbErrorCode } : {}),
      },
      {
        // configured | fallback_default | missing — сам адрес не печатается.
        // missing: прод без своего сервера векторов — векторы не считаются (provider.ts).
        name: 'ai_embed_base_url',
        status: process.env.AI_EMBED_BASE_URL ? 'configured' : embedRequired ? 'missing' : 'fallback_default',
      },
    ];

    const isReady = databaseConfigured && dbOk && (!embedRequired || Boolean(process.env.AI_EMBED_BASE_URL));
    return json(res, isReady ? 200 : 503, {
      status: isReady ? 'ready' : 'not_ready',
      checks,
    });
  }

  // POST /api/csp-report — приёмник нарушений политики безопасности (32 KB limit, bounded logging).
  // AUD-21: лимит стоит здесь, а не только в `api/csp-report.ts`. Прод ходит
  // этим маршрутом; фикс, положенный в вершеловский обработчик, приёмник на
  // VPS не защищал вовсе.
  if (method === 'POST' && path === '/api/csp-report') {
    if (rateLimited(clientIp(req as unknown as { headers: Record<string, unknown> }))) {
      res.writeHead(429);
      return res.end();
    }
    try {
      const raw = await readBody(req, 32 * 1024);
      const body = JSON.parse(raw);
      const report = body?.['csp-report'] ?? body;
      // M-18: поля свободные и от клиента — в журнал не больше 200 символов.
      const clamp = (x: unknown) => String(x ?? '').slice(0, 200);
      const summary = {
        // Полный URI несёт query-параметры страницы — в журнал уходит форма.
        'document-uri': clamp(originOnly(report?.['document-uri'])),
        'violated-directive': clamp(report?.['violated-directive']),
        'blocked-uri': clamp(originOnly(report?.['blocked-uri'])),
      };
      console.warn('[csp-report]', JSON.stringify(summary));
    } catch (err: unknown) {
      // R4-051: раньше 413 здесь тонул в общем catch и уходил 204 — клиент
      // не узнавал, что репорт не принят.
      if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', undefined, { Connection: 'close' });
        return;
      }
      /* ignore malformed */
    }
    res.writeHead(204);
    return res.end();
  }

  // POST /api/client-error — E-7: отчёт об ошибках клиента только по кнопке.
  // Белый список полей; message/stack/context не принимаются вовсе. В журнал —
  // одна строка с хэшем uid и счётчиками, без email и без текста.
  if (method === 'POST' && path === '/api/client-error') {
    if (rateLimited(clientIp(req as unknown as { headers: Record<string, unknown> }))) {
      json(res, 429, { error: { code: 'RATE_LIMIT', message: 'Too Many Requests' } });
      return;
    }
    let session = null;
    try {
      session = await requireSession(req);
    } catch {
      session = null;
    }
    if (!session?.uid) {
      sendError(res, 401, 'UNAUTHENTICATED');
      return;
    }
    let raw: string;
    try {
      raw = await readBody(req, 16 * 1024);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', undefined, { Connection: 'close' });
        return;
      }
      sendError(res, 400, 'INVALID_JSON');
      return;
    }
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      sendError(res, 400, 'INVALID_JSON');
      return;
    }
    const summary = clientErrorSummary(session.uid, parsed, String(req.headers['user-agent'] ?? ''));
    console.warn('[client-error]', JSON.stringify(summary));
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /api/chat — streaming chat endpoint (must be above /api/* dispatcher)
  if (method === 'POST' && path === '/api/chat') {
    await handleChat(req, res);
    return;
  }

  // POST /api/* — route to AI dispatcher
  if (method === 'POST' && path.startsWith('/api/')) {
    // Delegate to dispatcher which handles auth, rate limiting, and AI handlers
    await dispatch(req, res);
    return;
  }

  sendError(res, 404, 'NOT_FOUND');
  })().catch((e: unknown) => {
    // Без этого любой отказ, не пойманный внутри обработчика, становится
    // unhandled rejection, а Node на нём завершает процесс — один кривой
    // запрос ронял бы сервис целиком. Наружу отдаём общий текст: причина
    // уходит в журнал, клиенту причины не сообщаем.
    console.error('[server] unhandled request error', safeErrorShape(e));
    if (!res.headersSent) sendError(res, 500, 'INTERNAL');
    else res.end();
  });
});

// ── Start ──────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3000', 10);
// Только петля. deploy/nginx.conf держит инвариант «внутрь пускает только
// nginx» и прямо на него ссылается; без адреса Node слушает все интерфейсы, и
// инвариант держался на одном ufw. Апстрим nginx — 127.0.0.1:3000.
const HOST = '127.0.0.1';
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, HOST, () => {
    console.warn(`[justwriting] API listening on ${HOST}:${PORT}`);
  });
}

// CHOKE-2 / NARROW-3: Global safety net: log unhandled exceptions and rejections
// and terminate the process (process.exit(1)) so systemd (Restart=on-failure) can
// restart the service cleanly.
//
// Осознанный компромисс: страховка от полностью неожиданных ошибок должна
// оставаться «упасть и перезапуститься», а не «жить дальше в неизвестном состоянии»
// (продолжение работы после uncaughtException в повреждённой памяти недопустимо).
// Логирование обеспечивает видимость перед падением.
if (process.env.NODE_ENV !== 'test') {
  process.on('uncaughtException', (err) => {
    console.error('[server] uncaughtException', safeErrorShape(err));
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandledRejection', safeErrorShape(reason));
    process.exit(1);
  });
}

export default server;
