// AUD-21: пер-IP лимит на приёмник отчётов CSP.
//
// Живёт отдельным модулем, потому что приёмников два: `api/csp-report.ts`
// (вершеловский обработчик) и инлайновый маршрут в `api/server.ts` (то, что
// исполняется на VPS). Лимит, положенный только в первый, в проде не работал
// вовсе — тикет закрыт, тест зелёный, приёмник открыт. Один модуль на оба
// входа, чтобы «починено» и «починено там, где ходит прод» снова не разошлись.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

const hits = new Map<string, number[]>();

export function clientIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string | undefined } }): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

export function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

// AUDIT-L3: уборка по таймеру, а не полным сканом при >10k — иначе
// spoofed-XFF flood раздувает карту между редкими чистками.
let sweepStarted = false;
export function startHitsSweep(): void {
  if (sweepStarted || typeof setInterval === 'undefined') return;
  sweepStarted = true;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) {
      if (v.every(t => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }, 60_000);
  // Не держать процесс Node живым только ради таймера (VPS-вариант).
  (timer as unknown as { unref?: () => void }).unref?.();
}
startHitsSweep();

/**
 * Оставляет от URI только origin + path: query несёт данные страницы.
 *
 * `blocked-uri` часто вовсе не URL, а ключевое слово CSP — `inline`, `eval`,
 * `data`, `blob`. Возвращать для них undefined значит выбрасывать ровно то
 * поле, ради которого отчёт и читают: остаётся «что-то нарушено где-то».
 * Поэтому неразобранное значение отдаётся как есть, обрезанным по длине.
 */
export function originOnly(u: unknown): string | undefined {
  if (typeof u !== 'string' || u.length === 0) return undefined;
  try {
    const parsed = new URL(u);
    return parsed.origin + parsed.pathname;
  } catch {
    return u.slice(0, 100);
  }
}

export function __resetCspLimiterForTests(): void {
  hits.clear();
}
