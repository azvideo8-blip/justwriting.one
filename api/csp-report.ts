import type { VercelRequest, VercelResponse } from '@vercel/node';

// CSP violation report sink (SEC-21). Browsers POST here via the CSP
// `report-uri` directive when a policy is violated. We log server-side for
// visibility into XSS attempts / misconfigured directives and return 204.
// ponytail: log-only, no storage. Ship a store/alerting layer if volume warrants.

// AUD-21: лимитер вынесен в ./cspLimiter и разделён с боевым маршрутом в
// api/server.ts — своя копия здесь означала защиту в файле, которого прод не
// исполняет.
import { rateLimited, clientIp, originOnly } from './cspLimiter';

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

  const report = (req.body as { 'csp-report'?: unknown })?.['csp-report'] ?? (req.body as Record<string, unknown>) ?? {};
  // AUDIT-L2: только origin+path — query params могут нести PII.
  const summary = {
    'document-uri': originOnly(report['document-uri'] as string | undefined),
    'violated-directive': report['violated-directive'],
    'blocked-uri': originOnly(report['blocked-uri'] as string | undefined),
  };
  console.warn('[csp-report]', JSON.stringify(summary));
  res.status(204).end();
}
