// Один вход на :3000: /auth/v1 → GoTrue, /rest/v1 → PostgREST, остальное → Vite.
// Vite слушает IPv6 — поэтому `localhost`, не `127.0.0.1`.
import http from 'node:http';
import net from 'node:net';
const PORT = Number(process.env.STAND_PORT ?? 3000);
const GOTRUE = Number(process.env.STAND_GOTRUE_PORT ?? 9999);
const REST = Number(process.env.STAND_REST_PORT ?? 3003);
const VITE = Number(process.env.STAND_VITE_PORT ?? 3010);
// S-38: локальный api/server.ts (с заглушкой ИИ) подключается через STAND_API_PORT;
// без него /api, как и раньше, отвечает 503.
const API = process.env.STAND_API_PORT ? Number(process.env.STAND_API_PORT) : null;
const route = url => url.startsWith('/auth/v1/') ? { port: GOTRUE, path: url.slice(8) }
  : url.startsWith('/rest/v1/') ? { port: REST, path: url.slice(8) }
  : url.startsWith('/api/') ? (API ? { port: API, path: url } : null)
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
})
// Только loopback: ворота гоняют стенд на VPS-раннере (gates.yml) до 40 минут,
// и без хоста здесь прокси к стендовой Supabase висел бы на публичном
// интерфейсе без аутентификации. Playwright и curl на стенде ходят по
// localhost — наружу этот порт не нужен.
//
// 127.0.0.1, а не '::1': стенд поднимается ровно одним процессом, а Node на
// ::1 слушает только IPv6 (без dual-stack) — curl/Chromium на localhost,
// начав с A-записи, получили бы refused. Отдать оба адреса одним listen()
// нельзя, поэтому выбираем вариант, который не рвёт сам подъём стенда.
.listen(PORT, '127.0.0.1', () => console.log(`proxy :${PORT} (loopback)`));
