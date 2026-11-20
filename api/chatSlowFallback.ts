/**
 * Владелец 19.11: новая модель диалога у поставщика иногда отвечает очень
 * медленно (проба 19.11: v4.1-flash — 30 с до ответа, v4-flash — 1 с). Если до
 * первого слова прошло больше `firstTokenMs`, этот запрос обрывается и тот же
 * запрос уходит к прежней модели — человек не ждёт «пишет ответ… 30 с».
 *
 * Работает на уровне fetch поставщика: остальной путь хода (резерв лимита,
 * учёт, журнал [chat-end]) видит один ответ и не меняется. Срабатывает только
 * для потокового запроса основной модели диалога; служебные вызовы, рассуждения
 * и не-JSON тела идут как раньше. Быстрый отказ основной модели (ошибка, не 200)
 * отдаётся как есть — это не медленность, и подмена скрыла бы сбой.
 *
 * ponytail: «первое слово» — первый SSE-кусок с непустым `content`/`reasoning`
 * или конец потока; служебные «: processing» не считаются.
 */

export interface SlowFallbackOptions {
  primaryModel: string;
  fallbackModel: string;
  firstTokenMs: number;
  /** Строка журнала без содержимого: какая модель, сколько ждали. */
  onFallback?: (info: { from: string; to: string; waitedMs: number }) => void;
}

const FIRST_TOKEN_RE = /"(?:content|reasoning|reasoning_content)"\s*:\s*"[^"]|\[DONE\]|"finish_reason"\s*:\s*"/;

export function makeSlowFallbackFetch(base: typeof fetch, opts: SlowFallbackOptions): typeof fetch {
  if (opts.primaryModel === opts.fallbackModel) return base;
  return async (input, init) => {
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === 'string') {
      try {
        const parsed: unknown = JSON.parse(init.body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
      } catch { /* не JSON — отдаём как есть */ }
    }
    if (!body || body.stream !== true || body.model !== opts.primaryModel) return base(input, init);

    const outer = init?.signal ?? null;
    if (outer?.aborted) return base(input, init);
    const primaryCtl = new AbortController();
    const onOuterAbort = () => primaryCtl.abort();
    outer?.addEventListener('abort', onOuterAbort, { once: true });

    const startedAt = Date.now();
    const attempt = (async (): Promise<Response> => {
      const res = await base(input, { ...init, signal: primaryCtl.signal });
      if (!res.ok || !res.body) return res;
      const reader = res.body.getReader();
      const head: Uint8Array[] = [];
      const decoder = new TextDecoder();
      let seen = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        head.push(value);
        seen += decoder.decode(value, { stream: true });
        if (FIRST_TOKEN_RE.test(seen)) break;
        if (seen.length > 64_000) break; // ponytail: страховка от бесконечного «processing»
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { for (const chunk of head) controller.enqueue(chunk); },
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        },
        cancel(reason) { return reader.cancel(reason); },
      });
      return new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers });
    })();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<'slow'>(resolve => { timer = setTimeout(() => resolve('slow'), opts.firstTokenMs); });
    try {
      const winner = await Promise.race([attempt, slow]);
      if (winner !== 'slow') return winner;
    } finally {
      clearTimeout(timer);
    }

    primaryCtl.abort();
    attempt.catch(() => { /* намеренно: оборванный медленный запрос — не ошибка хода */ });
    outer?.removeEventListener('abort', onOuterAbort);
    opts.onFallback?.({ from: opts.primaryModel, to: opts.fallbackModel, waitedMs: Date.now() - startedAt });
    return base(input, { ...init, body: JSON.stringify({ ...body, model: opts.fallbackModel }) });
  };
}
