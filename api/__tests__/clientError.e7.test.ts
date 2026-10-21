// E-7: отчёт об ошибках клиента — белый список полей, только по кнопке.
// Проверяем и чистую сводку, и живой маршрут /api/client-error.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';

vi.mock('../auth', () => ({
  requireSession: vi.fn(),
  passwordRecentlyVerified: vi.fn(() => true),
}));

import server from '../server';
import { requireSession } from '../auth';
import { __resetCspLimiterForTests } from '../cspLimiter';
import { clientErrorSummary } from '../clientError';
import { activityToClientErrorRecords } from '../../src/features/settings/services/clientErrorReport';

let base = '';

beforeAll(async () => {
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => { server.close(() => resolve()); });
});

beforeEach(() => {
  __resetCspLimiterForTests();
  vi.mocked(requireSession).mockReset();
});

function post(ip: string, body: string) {
  return fetch(`${base}/api/client-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
    body,
  });
}

describe('E-7: серверный приёмник', () => {
  it('без сессии — 401', async () => {
    vi.mocked(requireSession).mockResolvedValueOnce(null);
    const res = await post('10.0.0.1', '{}');
    expect(res.status).toBe(401);
  });

  it('тело больше 16 КБ — 413', async () => {
    vi.mocked(requireSession).mockResolvedValue({ uid: 'u-1' } as never);
    const res = await post('10.0.0.2', 'x'.repeat(17 * 1024));
    expect(res.status).toBe(413);
  });

  it('чаще лимита — 429', async () => {
    vi.mocked(requireSession).mockResolvedValue({ uid: 'u-1' } as never);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await post('10.0.0.3', '{}')).status;
    expect(last).toBe(429);
  });

  it('MARKER в message/context в журнал не попадает, поля вне списка отброшены', async () => {
    vi.mocked(requireSession).mockResolvedValue({ uid: 'u-1' } as never);
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await post('10.0.0.4', JSON.stringify({
        appVersion: '0.10.7',
        records: [{
          action: 'loadDialogues',
          name: 'APICallError',
          code: 'bad_request',
          level: 'error',
          time: 1700000000000,
          message: 'MARKER_E7_TEXT',
          stack: 'MARKER_E7_TEXT',
          context: { note: 'MARKER_E7_TEXT' },
        }],
      }));
      expect(res.status).toBe(204);
      const line = log.mock.calls.map(args => args.map(String).join(' ')).join('\n');
      expect(line).toContain('[client-error]');
      expect(line).toContain('loadDialogues');
      expect(line).not.toContain('MARKER_E7_TEXT');
      expect(line).not.toContain('"message"');
      expect(line).not.toContain('"context"');
    } finally {
      log.mockRestore();
    }
  });
});

describe('E-7: клиентский отбор полей', () => {
  it('message и context записи журнала не уходят в отчёт', () => {
    const records = activityToClientErrorRecords([{
      id: 'a1', time: 1700000000000, message: 'MARKER_E7_TEXT', context: { note: 'MARKER_E7_TEXT' },
      level: 'error', source: 'loadDialogues', count: 1,
    }]);
    const body = JSON.stringify(records);
    expect(body).not.toContain('MARKER_E7_TEXT');
    expect(records[0]).toEqual({ action: 'loadDialogues', level: 'error', time: 1700000000000 });
  });

  it('сводка сервера не содержит message/stack/context', () => {
    const summary = clientErrorSummary('u-1', {
      records: [{ action: 'x', level: 'error', time: 1, message: 'MARKER_E7_TEXT', stack: 'MARKER_E7_TEXT', context: { a: 'MARKER_E7_TEXT' } }],
    }, 'Mozilla/5.0 (iPhone) Safari/604');
    expect(JSON.stringify(summary)).not.toContain('MARKER_E7_TEXT');
    expect(summary.browser).toBe('Safari');
    expect(summary.os).toBe('iOS');
  });
});
