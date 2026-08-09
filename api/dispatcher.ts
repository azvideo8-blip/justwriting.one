// dispatcher.ts – HTTP router for AI endpoints on the VPS

import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireSession } from './auth';
import { handleAiEndpoint } from './handlers';

/** Simple JSON responder utility */
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Read request body as string */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/** Main dispatcher entry point */
export async function handle(req: IncomingMessage, res: ServerResponse) {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';

  // Only POST under /api/* is supported for AI calls
  if (method !== 'POST' || !url.startsWith('/api/')) {
    return json(res, 404, { error: 'Not found' });
  }

  // Authenticate via Supabase JWT
  const session = requireSession(req);
  if (!session || !session.uid) {
    return json(res, 401, { error: 'Unauthenticated' });
  }

  // Resolve handler name (e.g., /api/chatWithAI -> "chatWithAI")
  const endpoint = url.slice('/api/'.length).split('?')[0] ?? '';

  // Parse JSON payload
  let payload: unknown = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const { status, body } = await handleAiEndpoint(endpoint, session.uid, payload);
  return json(res, status, body);
}
