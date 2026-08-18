import http from 'node:http';
import { handle as dispatch } from './dispatcher';
import { handleChat } from './chat';

// ── Helpers ────────────────────────────────────────────────────────────
function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Max payload size: 4MB (note version content schema allows up to 700k chars ~2MB in UTF-8, 4MB provides safety margin)
function readBody(req: http.IncomingMessage, maxBytes = 4 * 1024 * 1024): Promise<string> {
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

  // POST /api/csp-report — приёмник нарушений политики безопасности.
  if (method === 'POST' && url === '/api/csp-report') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw);
      const report = body?.['csp-report'] ?? body;
      console.warn('[csp-report]', JSON.stringify(report));
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

  json(res, 404, { error: 'Not found' });
  })();
});

// ── Start ──────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3000', 10);
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.warn(`[justwriting] API listening on :${PORT}`);
  });
}

export default server;
