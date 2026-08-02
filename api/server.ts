import http from 'node:http';
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ── Firebase Admin init (lazy) ─────────────────────────────────────────
const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID ?? undefined;

function getDb() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    } else {
      initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) });
    }
  }
  return getFirestore(FIRESTORE_DATABASE_ID!);
}

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
    try {
      const db = getDb();
      await db.listCollections();
      return json(res, 200, { status: 'ready' });
    } catch (e) {
      return json(res, 503, { status: 'not_ready', error: String(e) });
    }
  }

  // POST /api/chat — placeholder
  if (method === 'POST' && url === '/api/chat') {
    return json(res, 501, { error: 'Not yet implemented on VPS' });
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
server.listen(PORT, () => {
  console.warn(`[justwriting] API listening on :${PORT}`);
});

export default server;
