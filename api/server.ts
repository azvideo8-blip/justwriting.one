import http from 'node:http';
import { handle as dispatch } from './dispatcher';
import { handleChat } from './chat';
import { MAX_REQUEST_BODY_BYTES } from './ai/pure';
import { rateLimited, clientIp, originOnly } from './cspLimiter';
import { sendError } from './sendError';

// ── Helpers ────────────────────────────────────────────────────────────
function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Max payload size: 4MB (note version content schema allows up to 700k chars ~2MB in UTF-8, 4MB provides safety margin)
function readBody(req: http.IncomingMessage, maxBytes = MAX_REQUEST_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        req.destroy();
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

  // GET /health — liveness: "the process is alive"
  if (method === 'GET' && url === '/health') {
    return json(res, 200, { status: 'ok', uptime: process.uptime() });
  }

  // GET /ready — readiness: "dependencies available, send traffic"
  if (method === 'GET' && url === '/ready') {
    return json(res, 200, { status: 'ready', checks: [] });
  }

  // POST /api/csp-report — приёмник нарушений политики безопасности (32 KB limit, bounded logging).
  // AUD-21: лимит стоит здесь, а не только в `api/csp-report.ts`. Прод ходит
  // этим маршрутом; фикс, положенный в вершеловский обработчик, приёмник на
  // VPS не защищал вовсе.
  if (method === 'POST' && url === '/api/csp-report') {
    if (rateLimited(clientIp(req as unknown as { headers: Record<string, unknown> }))) {
      res.writeHead(429);
      return res.end();
    }
    try {
      const raw = await readBody(req, 32 * 1024);
      const body = JSON.parse(raw);
      const report = body?.['csp-report'] ?? body;
      const summary = {
        // Полный URI несёт query-параметры страницы — в журнал уходит форма.
        'document-uri': originOnly(report?.['document-uri']),
        'violated-directive': report?.['violated-directive'],
        'blocked-uri': originOnly(report?.['blocked-uri']),
      };
      console.warn('[csp-report]', JSON.stringify(summary));
    } catch { /* ignore malformed or payload too large */ }
    res.writeHead(204);
    return res.end();
  }

  // POST /api/chat — streaming chat endpoint (must be above /api/* dispatcher)
  if (method === 'POST' && url === '/api/chat') {
    await handleChat(req, res);
    return;
  }

  // POST /api/* — route to AI dispatcher
  if (method === 'POST' && url.startsWith('/api/')) {
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
    console.error('[server] unhandled request error', e);
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

export default server;
