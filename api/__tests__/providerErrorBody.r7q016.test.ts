import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generate } from '../ai/provider';

// R7Q-016 = R7F-011 (проба P4): провайдер в 4xx/5xx эхом возвращает кусок
// отправленного запроса — текст заметки, портрет, реплики диалога. Этот текст не
// должен ни печататься в журнал, ни оседать в Error.message (его печатают логики).
// Маркер выдуманный: живых формулировок в тесте нет.
const MARKER = 'ЦИТАТА-ИЗ-ТЕЛА-ОТКАЗА';

function http(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

/** Сообщение отказа; пустая строка, если промис разрешился — тогда проверка краснеет. */
async function rejectionMessage(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
}

const okBody = JSON.stringify({
  choices: [{ message: { content: 'готово' } }],
  usage: { prompt_tokens: 3, completion_tokens: 2 },
});

describe('R7Q-016: тело отказа провайдера не покидает процесс', () => {
  let logs: string[] = [];

  beforeEach(() => {
    logs = [];
    process.env.OPENROUTER_API_KEY = 'test-key-r7q016';
    for (const level of ['warn', 'error', 'log'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(a => String(a)).join(' '));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('502 с телом-маркером, затем 200: маркера нет ни в одном console.*', async () => {
    let attempt = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempt++;
      return attempt === 1 ? http(502, `upstream echoed: ${MARKER}`) : http(200, okBody);
    }));

    const res = await generate({ messages: [{ role: 'user', content: 'проверка' }] });
    // Положительный контроль: ответ действительно прошёл через 502 и ретрай.
    expect(attempt).toBe(2);
    expect(res.text).toBe('готово');
    expect(logs.join('\n')).not.toContain(MARKER);
  });

  it('400 с телом-маркером: маркера нет в Error.message, статус назван', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => http(400, JSON.stringify({ error: { message: MARKER } }))));

    const message = await rejectionMessage(generate({ messages: [{ role: 'user', content: 'проверка' }] }));

    expect(message).toContain('400');
    expect(message).not.toContain(MARKER);
  });

  it('отказ с текстом про квоту узнаётся без тела: в сообщении остаётся метка quota', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => http(429, `Free tier: ${MARKER} spending cap exceeded`)));

    const message = await rejectionMessage(generate({ messages: [{ role: 'user', content: 'проверка' }] }));

    expect(/quota|spending cap|exceeded/i.test(message)).toBe(true);
    expect(message).not.toContain(MARKER);
  });

  it('embed: 400 с телом-маркером — маркера нет в сообщении ошибки', async () => {
    const { embed } = await import('../ai/provider');
    vi.stubGlobal('fetch', vi.fn(async () => http(400, `echo: ${MARKER}`)));

    const message = await rejectionMessage(embed(['проверка']));

    expect(message).toContain('400');
    expect(message).not.toContain(MARKER);
  });
});
