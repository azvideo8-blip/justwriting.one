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
): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: { code, message: message ?? code } }));
}
