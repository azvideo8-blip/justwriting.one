#!/usr/bin/env node
// Заглушка ИИ для локального стенда (scripts/stand/up.sh): OpenAI-совместимые
// /v1/chat/completions (стрим и обычный ответ) и /v1/embeddings.
//
// Она в репозитории, а не в /tmp, по конкретной причине: прежняя ad-hoc
// заглушка возвращала ПУСТОЙ список памяти, и из-за этого сценарии с памятью на
// стенде не гонялись вовсе (см. s38-stand-run-2026-10-02.md, «не гонялись:
// 5 и 17»). Память здесь обязана быть непустой.
//
//   STAND_AI_STUB_PORT=3105 node scripts/stand/ai-stub.mjs
//   # и для api/server.ts: AI_BASE_URL=http://127.0.0.1:3105/v1
//
// Что заглушка умеет отвечать, чтобы фоновые проходы не падали молча:
//  • чат — «ответ заглушки на: <ход>», по чанкам с задержкой; маркер [slow] в
//    последнем ходе растягивает стрим (нужно для «забор во время стрима»);
//  • извлечение памяти — непустой JSON-список единиц;
//  • суммаризация убеждения — текст убеждения; судья убеждений — JSON-вердикт;
//  • эмбеддинги — детерминированный вектор размерности клиента.
//
// Ключа у заглушки нет: Authorization она не проверяет и никуда не пересылает.
import http from 'node:http';

const PORT = Number(process.env.STAND_AI_STUB_PORT ?? 3105);
const HOST = '127.0.0.1';
// Задержка между чанками стрима. Обычный ход остаётся быстрым; [slow] — длинный.
const CHUNK_DELAY_MS = Number(process.env.STAND_AI_STUB_CHUNK_MS ?? 200);
const SLOW_CHUNK_DELAY_MS = Number(process.env.STAND_AI_STUB_SLOW_CHUNK_MS ?? 2_000);
const SLOW_PARTS = Number(process.env.STAND_AI_STUB_SLOW_PARTS ?? 8);
const EMBED_DIM = Number(process.env.STAND_AI_STUB_EMBED_DIM ?? 1024);
// Задержка ответа на извлечение памяти, если в диалоге есть маркер
// [memory-delay]. Без неё извлечение занимает ~50 мс и окно «ход удалили, пока
// память считалась» на стенде поймать невозможно.
const MEMORY_DELAY_MS = Number(process.env.STAND_AI_STUB_MEMORY_MS ?? 12_000);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 32 * 1024 * 1024) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const lastUser = (messages) => String([...messages].reverse().find((m) => m.role === 'user')?.content ?? '').trim();
const systemOf = (messages) => String(messages.find((m) => m.role === 'system')?.content ?? '');

/** Ответ чата: эхо последнего хода + уникальный хвост. Настоящая модель на
 *  перегенерации даёт другой текст, а AIDialogueService выкидывает из вариантов
 *  повторы — с одинаковым ответом «перегенерация» не создала бы второй вариант,
 *  и стенд не мог бы проверить ни слияние вариантов, ни их перелистывание. */
let answerSeq = 0;

function chatAnswer(messages) {
  const asked = lastUser(messages).replace(/\[(slow|memory-delay)\]/g, '').replace(/\s+/g, ' ').slice(-160);
  return `ответ заглушки на: ${asked} · ${++answerSeq}`;
}

/** Чем отвечать на non-stream вызов — по системному промпту вызывающей функции. */
async function completionContent(messages) {
  const sys = systemOf(messages);
  if (sys.includes('Извлеки долговременные единицы памяти')) {
    // Пустой список here = курсор памяти не двигается, и сценарии памяти на
    // стенде молча не проверяются. Поэтому память всегда непустая.
    const whole = lastUser(messages);
    if (whole.includes('[memory-delay]')) {
      console.warn(`[ai-stub] память: держу ответ ${MEMORY_DELAY_MS} мс (маркер в диалоге)`);
      await sleep(MEMORY_DELAY_MS);
    }
    const asked = whole.replace(/\[CONVERSATION_(START|END)\]/g, '').replace('[memory-delay]', '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return JSON.stringify([
      { kind: 'insight', text: `Пользователь обсуждал: ${asked || 'записи стенда'}` },
      { kind: 'commitment', text: 'Пользователь собирается вернуться к этому позже' },
    ]);
  }
  if (sys.includes('придирчивый AI-Судья')) {
    return JSON.stringify({ passed: true, reason: 'заглушка стенда: убеждение принято', correctiveHint: '' });
  }
  if (sys.includes('сформулировать ОДНО устойчивое смысловое убеждение')) {
    return 'Заглушка: пользователь внимательно относится к деталям.';
  }
  return chatAnswer(messages);
}

function chunk(id, model, created, delta, finish) {
  return `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta, ...(finish ? { finish_reason: finish } : { finish_reason: null }) }],
  })}\n\n`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function streamChat(res, id, model, created, text, slow) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const parts = [];
  if (slow) {
    // Равные куски, чтобы стрим шёл SLOW_CHUNK_DELAY_MS × SLOW_PARTS: забор
    // обязан успеть начаться, пока ход ещё не дописан в базу.
    const step = Math.ceil(text.length / SLOW_PARTS);
    for (let i = 0; i < text.length; i += step) parts.push(text.slice(i, i + step));
  } else {
    parts.push(text.slice(0, Math.ceil(text.length / 3)), text.slice(Math.ceil(text.length / 3), Math.ceil((2 * text.length) / 3)), text.slice(Math.ceil((2 * text.length) / 3)));
  }
  void (async () => {
    res.write(chunk(id, model, created, { role: 'assistant' }));
    for (const p of parts) {
      if (p) { res.write(chunk(id, model, created, { content: p })); await sleep(slow ? SLOW_CHUNK_DELAY_MS : CHUNK_DELAY_MS); }
    }
    res.write(chunk(id, model, created, {}, 'stop'));
    res.end('data: [DONE]\n\n');
  })().catch(() => res.end());
}

const server = http.createServer((req, res) => {
  void (async () => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: [{ id: 'stand-stub', owned_by: 'stand' }] }));
    }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: `stub: тело не разобрано: ${String(e)}` } }));
    }
    const created = Math.floor(Date.now() / 1000);
    const id = `chatcmpl-stub-${created}`;
    const model = String(body.model ?? 'stand-stub');
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (path === '/v1/embeddings' || path === '/embeddings') {
      const inputs = typeof body.input === 'string' ? [body.input] : Array.isArray(body.input) ? body.input : [];
      const data = inputs.map((text, index) => {
        // Детерминированный вектор: один и тот же текст даёт одно и то же
        // число, поэтому повторный вызов не выглядит как новое содержимое.
        let h = 2166136261;
        for (let i = 0; i < String(text).length; i++) { h ^= String(text).charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        const embedding = new Array(EMBED_DIM);
        for (let i = 0; i < EMBED_DIM; i++) { h = (Math.imul(h, 1103515245) + 12345) >>> 0; embedding[i] = (h / 0xffffffff) * 2 - 1; }
        return { object: 'embedding', index, embedding };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data, model, usage: { prompt_tokens: 0, total_tokens: 0 } }));
    }

    if (path === '/v1/chat/completions' || path === '/chat/completions') {
      if (body.stream === true) {
        return streamChat(res, id, model, created, chatAnswer(messages), /\[slow\]/.test(lastUser(messages)));
      }
      const content = await completionContent(messages);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        id, object: 'chat.completion', created, model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4), completion_tokens: Math.ceil(content.length / 4), total_tokens: Math.ceil((JSON.stringify(messages).length + content.length) / 4) },
      }));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `stub: неизвестный путь ${path}` } }));
  })().catch((e) => {
    console.error('[ai-stub]', e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: String(e) } }));
    else res.end();
  });
});

server.listen(PORT, HOST, () => console.warn(`[ai-stub] http://${HOST}:${PORT}/v1 (память непустая, [slow] растягивает стрим)`));
