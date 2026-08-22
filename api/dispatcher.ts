import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireSession } from './auth';
import { handleAiEndpoint } from './handlers';
import { MAX_REQUEST_BODY_BYTES } from './ai/pure';

/** Simple JSON responder utility */
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Max payload size: 4MB (note version content schema allows up to 700k chars ~2MB in UTF-8, 4MB provides safety margin)
function readBody(req: IncomingMessage, maxBytes = MAX_REQUEST_BODY_BYTES): Promise<string> {
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

/** Main dispatcher entry point */
export async function handle(req: IncomingMessage, res: ServerResponse) {
  try {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';

    // Only POST under /api/* is supported for AI calls
    if (method !== 'POST' || !url.startsWith('/api/')) {
      return json(res, 404, { error: 'Not found' });
    }

    // Authenticate via Supabase JWT
    const session = await requireSession(req);
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
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
        return json(res, 413, { error: 'Payload too large' });
      }
      return json(res, 400, { error: 'Invalid JSON body' });
    }

    const { status, body } = await handleAiEndpoint(endpoint, session.uid, payload);
    return json(res, status, body);
  } catch (err: unknown) {
    console.error('[dispatcher error]', err);
    return json(res, 500, { error: 'Internal server error' });
  }
}
