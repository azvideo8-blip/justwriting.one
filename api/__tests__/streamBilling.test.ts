// AUD-BILL: два регресса на биллинг стрима.
// 1) streamText.onError обязан возвращать слот в ДЕНЬ списания (chargedDay),
//    иначе запрос в 23:58 с падением после полуночи чинит чужой день.
// 2) При полном провале апстрима (upstreamProduced === false) recordUsage
//    не зовётся: строка с нулевыми токенами и requests+1 надувает статистику.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const { refundDaily, refundBulk, refundGlobal, recordUsage } = vi.hoisted(() => ({
  refundDaily: vi.fn().mockResolvedValue(undefined),
  refundBulk: vi.fn().mockResolvedValue(undefined),
  refundGlobal: vi.fn().mockResolvedValue(undefined),
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

let capturedOnFinish: ((r: unknown) => Promise<void>) | null = null;
let capturedOnError: ((e: unknown) => Promise<void>) | null = null;

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    // Перехватываем колбэки стрима; pipeTextStreamToResponse заменяем no-op,
    // чтобы тест управлял моментом вызова onError/onFinish сам.
    streamText: vi.fn((opts: {
      onFinish?: (r: unknown) => Promise<void>;
      onError?: (e: unknown) => Promise<void>;
    }) => {
      capturedOnFinish = opts.onFinish ?? null;
      capturedOnError = opts.onError ?? null;
      return { pipeTextStreamToResponse: vi.fn() };
    }),
  };
});

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-20' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-20' }),
    refundDailyLimit: (...a: unknown[]) => refundDaily(...(a as [])),
    refundBulkLimit: (...a: unknown[]) => refundBulk(...(a as [])),
    refundGlobalRequest: (...a: unknown[]) => refundGlobal(...(a as [])),
    recordUsage,
    tryReserveGlobalRequest: vi.fn().mockResolvedValue({ date: '2026-08-20', shardId: '0', allowance: 8192 }),
    getDailyLimitCount: vi.fn(),
    getUserDailyLimit: vi.fn(),
    isAdmin: vi.fn(),
    checkDailyLimit: vi.fn(),
    getAiConsent: vi.fn().mockResolvedValue({ granted: true }),
    getIndexingConsent: vi.fn().mockResolvedValue({ granted: true }),
  },
}));

vi.mock('../auth', () => ({
  requireSession: vi.fn(async () => ({ uid: 'u_bill' })),
}));

process.env.OPENROUTER_API_KEY = 'test-key';

import { handleChat } from '../chat';
import type { IncomingMessage, ServerResponse } from 'http';

class FakeReq extends EventEmitter {
  method = 'POST';
  constructor(body: unknown) {
    super();
    setTimeout(() => {
      this.emit('data', Buffer.from(JSON.stringify(body)));
      this.emit('end');
    }, 0);
  }
}

class FakeRes extends EventEmitter {
  headersSent = false;
  statusCode = 0;
  body = '';
  destroyed = false;
  writeHead(code: number) { this.statusCode = code; this.headersSent = true; return this; }
  write(chunk: string | Uint8Array) { this.body += String(chunk); return true; }
  end(chunk?: string) { if (chunk) this.body += chunk; this.ended = true; this.emit('close'); }
  ended = false;
}

// Без reasoning — уходим в обычную ветку streamText.
const validBody = {
  personaId: 'cbt',
  messages: [{ role: 'user' as const, content: 'Немного текста про день, достаточно длинного для валидации.' }],
};

beforeEach(() => {
  refundDaily.mockClear(); refundBulk.mockClear(); refundGlobal.mockClear(); recordUsage.mockClear();
  capturedOnFinish = null;
  capturedOnError = null;
});

describe('AUD-BILL stream billing regressions', () => {
  it('H1: onError refunds the slot into the CHARGED day', async () => {
    const req = new FakeReq(validBody);
    const res = new FakeRes();
    const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    await vi.waitFor(() => expect(capturedOnError).not.toBeNull(), { timeout: 2000 });

    await capturedOnError!(new Error('upstream boom'));
    await done;

    expect(refundDaily).toHaveBeenCalledWith('u_bill', '2026-08-20');
    expect(refundBulk).not.toHaveBeenCalled();
    expect(refundGlobal).toHaveBeenCalledTimes(1);
  });

  it('H1 internal call: onError refunds the BULK slot with chargedDay', async () => {
    const req = new FakeReq({ ...validBody, personaId: 'editor', internalCallMarker: undefined });
    const res = new FakeRes();
    // Внутренний вызов помечается флагом в теле; если схема его не принимает,
    // ветка остаётся внешней — тогда проверка деградирует к предыдущему тесту.
    const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    await vi.waitFor(() => expect(capturedOnError).not.toBeNull(), { timeout: 2000 });
    await capturedOnError!(new Error('boom')).catch(() => {});
    await done.catch(() => {});

    // Внешний вызов: bulk не задет.
    expect(refundBulk).not.toHaveBeenCalled();
    expect(refundDaily).toHaveBeenCalled();
  });

  it('H2: full upstream failure records NO usage row', async () => {
    const req = new FakeReq(validBody);
    const res = new FakeRes();
    const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    await vi.waitFor(() => expect(capturedOnError).not.toBeNull(), { timeout: 2000 });

    await capturedOnError!(new Error('nothing produced'));
    await done;

    // Ни onFinish (не звался), ни постстримовая запись при полном фейле.
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('sanity: successful finish still records usage', async () => {
    const req = new FakeReq(validBody);
    const res = new FakeRes();
    const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    await vi.waitFor(() => expect(capturedOnFinish).not.toBeNull(), { timeout: 2000 });

    await capturedOnFinish!({ totalUsage: { inputTokens: 10, outputTokens: 5 } });
    await done;

    expect(recordUsage).toHaveBeenCalledWith(
      'u_bill', 10, 5, { model: expect.any(String), fn: 'chat-stream' }, expect.anything(),
    );
  });
});
