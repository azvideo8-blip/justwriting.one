// Владелец 19.11: медленная основная модель диалога — тот же запрос уходит к
// прежней. Мутации (прогнаны): убрать подмену модели в повторе — красный (1);
// не обрывать основной запрос — красный (1); срабатывать и на служебной модели —
// красный (3); терять буфер первых кусков быстрого ответа — красный (2).
import { describe, it, expect, vi } from 'vitest';
import { makeSlowFallbackFetch } from '../chatSlowFallback';

const enc = new TextEncoder();
const sse = (...parts: string[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); },
});
const opts = { primaryModel: 'new-model', fallbackModel: 'old-model', firstTokenMs: 30 };
const req = (model: string, stream = true) => ({ method: 'POST', body: JSON.stringify({ model, stream, messages: [] }) });

describe('makeSlowFallbackFetch', () => {
  it('1: основная молчит дольше срока — запрос уходит к прежней модели, основная оборвана', async () => {
    let primarySignal: AbortSignal | undefined;
    const base = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model;
      if (model === 'new-model') {
        primarySignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {}); // висит
      }
      return new Response(sse('data: {"choices":[{"delta":{"content":"ок"}}]}\n\n'), { status: 200 });
    });
    const onFallback = vi.fn();
    const f = makeSlowFallbackFetch(base as unknown as typeof fetch, { ...opts, onFallback });
    const res = await f('u', req('new-model'));
    expect(await res.text()).toContain('ок');
    expect(JSON.parse(String(base.mock.calls[1]![1]!.body)).model).toBe('old-model');
    expect(primarySignal?.aborted).toBe(true);
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ from: 'new-model', to: 'old-model' }));
  });

  it('2: основная ответила вовремя — её поток целиком, без повтора', async () => {
    const base = vi.fn(async () => new Response(sse(
      ': processing\n\n',
      'data: {"choices":[{"delta":{"content":"раз"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"два"}}]}\n\n',
      'data: [DONE]\n\n',
    ), { status: 200 }));
    const f = makeSlowFallbackFetch(base as unknown as typeof fetch, opts);
    const text = await (await f('u', req('new-model'))).text();
    expect(text).toContain(': processing');
    expect(text).toContain('раз');
    expect(text).toContain('два');
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('3: служебная модель, не поток и быстрый отказ — без подмены', async () => {
    const base = vi.fn(async () => new Response('nope', { status: 500 }));
    const f = makeSlowFallbackFetch(base as unknown as typeof fetch, opts);
    expect((await f('u', req('old-model'))).status).toBe(500);
    expect((await f('u', req('new-model', false))).status).toBe(500);
    expect((await f('u', req('new-model'))).status).toBe(500);
    // Каждый вызов — один запрос, повтора к прежней модели нет.
    expect(base).toHaveBeenCalledTimes(3);
    expect((base.mock.calls as unknown as [unknown, RequestInit][]).map(c => JSON.parse(String(c[1].body)).model))
      .toEqual(['old-model', 'new-model', 'new-model']);
  });

  it('4: медленная служебная модель — ждём её, второго запроса нет', async () => {
    const base = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 80));
      return new Response(sse('data: {"choices":[{"delta":{"content":"служба"}}]}\n\n'), { status: 200 });
    });
    const f = makeSlowFallbackFetch(base as unknown as typeof fetch, opts);
    expect(await (await f('u', req('old-model'))).text()).toContain('служба');
    expect(base).toHaveBeenCalledTimes(1);
  });
});

