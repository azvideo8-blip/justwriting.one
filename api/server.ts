import http from 'node:http';
import { handle as dispatch } from './dispatcher';
// ── Firebase Admin init (lazy) ─────────────────────────────────────────

// ── Helpers ────────────────────────────────────────────────────────────
function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
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
    // Пока проверять нечего: Supabase не подключён, а Firestore этот рантайм
    // ставится ради того, чтобы перестать использовать. Поэтому готовность
    // сейчас означает ровно то же, что и живость. Когда появится Supabase,
    // сюда должна прийти проверка соединения с ним — до тех пор балансировщик
    // по /ready ничего осмысленного не узнаёт, и в README про это сказано.
    return json(res, 200, { status: 'ready', checks: [] });
  }

  // POST /api/* — route to AI dispatcher
  if (method === 'POST' && url.startsWith('/api/')) {
    // Delegate to dispatcher which handles auth, rate limiting, and AI handlers
    await dispatch(req, res);
    return;
  }

  // POST /api/csp-report — CSP violation sink
  if (method === 'POST' && url === '/api/csp-report') {
    const raw = await readBody(req);
    try {
      const body = JSON.parse(raw);
      const report = body?.['csp-report'] ?? body;
      console.warn('[csp-report]', JSON.stringify(report));
    } catch { /* ignore malformed */ }
    res.writeHead(204);
    return res.end();
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
