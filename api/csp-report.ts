import type { VercelRequest, VercelResponse } from '@vercel/node';

// CSP violation report sink (SEC-21). Browsers POST here via the CSP
// `report-uri` directive when a policy is violated. We log server-side for
// visibility into XSS attempts / misconfigured directives and return 204.
// ponytail: log-only, no storage. Ship a store/alerting layer if volume warrants.
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
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
