import type { VercelRequest, VercelResponse } from '@vercel/node';

// CSP violation report sink (SEC-21). Browsers POST here via the CSP
// `report-uri` directive when a policy is violated. We log server-side for
// visibility into XSS attempts / misconfigured directives and return 204.
// ponytail: log-only, no storage. Ship a store/alerting layer if volume warrants.

// AUD-21: приёмник открыт всем и без лимита — 32 KB cap ограничивал только
// разовый размер, но не частоту. Простой скользящий окно на IP закрывает
// заливку журнала. In-memory в serverless — на инстанс; этого достаточно,
// чтобы сделать заливку дороже смысла.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

const hits = new Map<string, number[]>();

function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  // Периодическая уборка: карта не должна расти вместе с числом адресов.
  if (hits.size > 10_000) {
    for (const [k, v] of hits) {
      if (v.every(t => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return recent.length > MAX_PER_WINDOW;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  if (rateLimited(clientIp(req))) {
    res.status(429).json({ error: 'Too Many Requests' });
    return;
  }
  if (req.body && JSON.stringify(req.body).length > 10_000) {
    res.status(413).json({ error: 'Payload Too Large' });
    return;
  }
  // Body shape is `{ "csp-report": {...} }`; Vercel parses JSON bodies.

  const report = (req.body as { 'csp-report'?: unknown })?.['csp-report'] ?? req.body;
  console.warn('[csp-report]', JSON.stringify(report));
  res.status(204).end();
}
