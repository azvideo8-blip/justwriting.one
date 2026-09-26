// Один вход на :3000: /auth/v1 → GoTrue, /rest/v1 → PostgREST, остальное → Vite.
// Vite слушает IPv6 — поэтому `localhost`, не `127.0.0.1`.
import http from 'node:http';
import net from 'node:net';
const PORT = Number(process.env.STAND_PORT ?? 3000);
const GOTRUE = Number(process.env.STAND_GOTRUE_PORT ?? 9999);
const REST = Number(process.env.STAND_REST_PORT ?? 3003);
const VITE = Number(process.env.STAND_VITE_PORT ?? 3010);
const route = url => url.startsWith('/auth/v1/') ? { port: GOTRUE, path: url.slice(8) }
  : url.startsWith('/rest/v1/') ? { port: REST, path: url.slice(8) }
  : url.startsWith('/api/') ? null
  : { port: VITE, path: url };
http.createServer((req, res) => {
  const r = route(req.url);
  if (!r) { res.writeHead(503).end('api not running on the stand'); return; }
  const p = http.request({ host: 'localhost', port: r.port, path: r.path, method: req.method, headers: { ...req.headers, host: `localhost:${r.port}` } }, up => {
    res.writeHead(up.statusCode, up.headers); up.pipe(res);
  });
  p.on('error', e => { res.writeHead(502).end(String(e)); });
  req.pipe(p);
}).on('upgrade', (req, sock, head) => {
  // Realtime-сокет (/realtime/v1) на стенде не поднят: соединение просто рвётся, клиент повторяет.
  const up = net.connect(VITE, 'localhost', () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    up.write(head); up.pipe(sock); sock.pipe(up);
  });
  up.on('error', () => sock.destroy());
  sock.on('error', () => up.destroy());
}).listen(PORT, () => console.log(`proxy :${PORT}`));
