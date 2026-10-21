import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireSession, passwordRecentlyVerified } from './auth';
import { handleAiEndpoint } from './handlers';
import { sendError } from './sendError';
import { MAX_REQUEST_BODY_BYTES, DAILY_LIMIT, ADMIN_DAILY_LIMIT } from './ai/pure';
import { postgresAiContext } from './postgresAiContext';
import { safeErrorShape } from '../src/shared/ai/errorShape.js';

/** Simple JSON responder utility */
function json(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
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

/** Main dispatcher entry point */
export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';

    // Only POST under /api/* is supported for AI calls
    if (method !== 'POST' || !url.startsWith('/api/')) {
      // AUDIT-part2 7.1: единая форма ошибок. Информационные ответы (не
      // контрактные коды вроде RATE_LIMIT — клиент матчит их строкой в
      // useAIChat) переведены на sendError; контрактные остаются legacy до
      // двоичной совместимости парсера на клиенте.
      sendError(res, 404, 'NOT_FOUND');
      return;
    }

    // Authenticate via Supabase JWT
    const session = await requireSession(req);
    if (!session || !session.uid) {
      sendError(res, 401, 'UNAUTHENTICATED');
      return;
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
        // R4-051: Connection: close — сокет закрывается после ответа.
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', undefined, { Connection: 'close' });
        return;
      }
      sendError(res, 400, 'INVALID_JSON');
      return;
    }

    // AUD-20: необратимое удаление требует свежего ввода пароля. Клиент делает
    // reauthenticate перед вызовом; здесь это подтверждается по подписанному
    // токену, чтобы прямой вызов с живым токеном не стирал архив в обход экрана.
    // R7Q-009: `adminDeleteUser` — второе необратимое удаление на сервере, и оно
    // этого барьера не платило: украденный живой токен стирал чужой дневник
    // одним POST'ом, хотя прочитать его не мог.
    if ((endpoint === 'deleteAccount' || endpoint === 'adminDeleteUser') && !passwordRecentlyVerified(session)) {
      json(res, 403, { error: { code: 'REAUTH_REQUIRED', message: 'Re-enter your password to delete the account.' } });
      return;
    }

    const { status, body } = await handleAiEndpoint(endpoint, session.uid, payload);
    let quotaHeaders: Record<string, string> | undefined;
    try {
      const quota = await postgresAiContext.getDailyLimitCount(session.uid);
      const isAdmin = await postgresAiContext.isAdmin(session.uid);
      quotaHeaders = {
        'X-AI-Quota-Used': String(quota.used),
        'X-AI-Quota-Limit': String(isAdmin ? ADMIN_DAILY_LIMIT : DAILY_LIMIT),
        'X-AI-Reasoning-Used': String(quota.reasoningUsed ?? 0),
        'X-AI-Reasoning-Limit': process.env.AI_REASONING_DAILY_LIMIT || '5',
      };
    } catch {
      // SA-2: отказ чтения лимита не критичен для ответа, но молчать нельзя —
      // без заголовков клиент считает это «ничего нового» и продолжает
      // показывать прошлое подтверждённое число нынешнее.
      quotaHeaders = { 'X-AI-Quota-Status': 'unavailable' };
    }
    json(res, status, body, quotaHeaders);
  } catch (err: unknown) {
    console.error('[dispatcher error]', safeErrorShape(err));
    sendError(res, 500, 'INTERNAL');
  }
}
