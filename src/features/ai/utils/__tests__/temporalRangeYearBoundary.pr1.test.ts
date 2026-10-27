// PA-1 (тикет 26.10) — два места PR-1, которые его тест не проверял:
// (1) «с 10.10 по 24.10», сказанное в январе: обе даты ещё далеко впереди,
//     значит год — прошлый, а не этот;
// (2) правило «дальше 92 дней вперёд → прошлый год» на самой границе
//     (91 / 92 / 93 дня): `>` vs `>=` на этой строке даёт разный год.
// Мутация: `> PREV_YEAR_WINDOW_DAYS` → `>=` — (3) красный;
//         убрать `yearFor` из parseNumericRange (всегда этот год) — (1) красный.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseTemporalQuery } from '../temporalQueryParser';

function at(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}
afterEach(() => vi.useRealTimers());

describe('PA-1: год без года и граница 92 дней', () => {
  it('«с 10.10 по 24.10» в январе — обе даты прошлого года', () => {
    at('2026-01-05T12:00:00');
    expect(parseTemporalQuery('что я писал с 10.10 по 24.10')).toMatchObject({
      type: 'dateRange', from: '2025-10-10', to: '2025-10-24',
    });
  });

  it('«с 25 декабря по 5 января» в январе — период через границу года', () => {
    at('2026-01-10T12:00:00');
    expect(parseTemporalQuery('что было с 25 декабря по 5 января')).toMatchObject({
      type: 'dateRange', from: '2025-12-25', to: '2026-01-05',
    });
  });

  it('91 и 92 дня впереди — этот год, 93 — прошлый', () => {
    // сегодня 5 января 2026: 6 апреля = +91 сут, 7 апреля = +92, 8 апреля = +93.
    at('2026-01-05T12:00:00');
    expect(parseTemporalQuery('что было 6 апреля').from, '+91 сут').toBe('2026-04-06');
    expect(parseTemporalQuery('что было 7 апреля').from, '+92 сут — ровно окно').toBe('2026-04-07');
    expect(parseTemporalQuery('что было 8 апреля').from, '+93 сут — за окном').toBe('2025-04-08');
  });
});
