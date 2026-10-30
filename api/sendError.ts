// AUDIT-L6: единая форма ошибок { error: { code, message } }.
// До этого ответов было три: {error:string} (handlers), {error:{code,message}}
// (dispatcher) и plain-text 502/504 (chat). Новые эндпоинты обязаны использовать
// этот хелпер; legacy-формы мигрируются при касании (контракт клиентов).
import type { ServerResponse } from 'http';

export function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message?: string,
  extraHeaders?: Record<string, string>,
): void {
  // DY10-2 (дейлик 30.10): одна метка на любой 5xx через этот помощник — по ней
  // считает монитор E-8 (ветка «хода мысли» в api/chat.ts пишет свои тексты, и
  // счёт по ним её не видел). Только статус и код — без текста запроса.
  if (status >= 500) console.error(`[api-5xx] ${status} ${code}`);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify({ error: { code, message: message ?? code } }));
}
