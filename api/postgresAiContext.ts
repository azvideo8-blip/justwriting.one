// api/postgresAiContext.ts
// Postgres-backed implementation of AiContext for the VPS service.
// Uses the tables created in supabase/migrations/0004_ai_counters.sql and 0005_ai_global_daily_tokens.sql.

import type { AiContext, GlobalReservation, LimitVerdict } from '../src/shared/ai/context.js';
import { AI_CONSENT_VERSION_REQUIRED, INDEXING_CONSENT_VERSION } from '../src/shared/ai/consentVersion.js';
// EA-10: ADMIN_DAILY_LIMIT — одно число с заголовками квоты, иначе админ видел x/60, а упирался в 20.
import { DAILY_LIMIT, ADMIN_DAILY_LIMIT } from './ai/pure';

import type { PoolClient } from 'pg';

import { pool } from './db';
import { safeErrorShape } from '../src/shared/ai/errorShape.js';

// N-77: запрос внутри транзакции обязан идти на том же соединении, что держит
// BEGIN. Иначе это вторая покупка соединения из того же пула, и при полном пуле
// транзакция ждёт его навсегда.
type Queryable = Pick<PoolClient, 'query'>;

// Postgres error code, if the thrown thing carries one (pg errors do).
function pgCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string'
    ? (e as { code: string }).code
    : undefined;
}

const today = () => new Date().toISOString().slice(0, 10);

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const trimmed = raw.trim();
  const num = Number(trimmed);
  if (!/^\d+$/.test(trimmed) || num <= 0 || !Number.isSafeInteger(num)) {
    throw new Error(`Invalid environment variable ${name}="${raw}": must be a positive integer.`);
  }
  return num;
}

// C-4: значение рублёвого потолка может быть дробным (12.5), поэтому не envInt.
// Зато мусор обязан падать на старте с именем переменной: parseFloat('abc')
// давал NaN, и либо весь ИИ отвечал 503, либо потолок молча выключался.
export function envPositiveNumber(name: string, fallback: number | null): number | null {
  const raw = process.env[name];
  // Пустое значение — как незаданное (так пишет шаблон `deploy/.env.example`, и
  // так же читает соседний envInt): иначе установка по шаблону не стартует.
  if (raw === undefined || raw.trim() === '') return fallback;
  const trimmed = raw.trim();
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`Invalid environment variable ${name}="${raw}": must be a positive finite number.`);
  }
  return num;
}

// ── Global daily cap & Spend ceiling in Rubles ───────────────────────────────
const GLOBAL_DAILY_LIMIT = envInt('AI_TIER_RPD', 10000);
const GLOBAL_TOKEN_LIMIT = envInt('AI_TIER_TPD', 25000000);

// Hard spend ceiling in Rubles per day (e.g. AI_DAILY_SPEND_LIMIT_RUB=100)
// Defaults to unlimited/token-capped if not set.
const RUB_PER_1M_TOKENS = envPositiveNumber('AI_RUB_PER_1M_TOKENS', 30)!;
const DAILY_SPEND_LIMIT_RUB = envPositiveNumber('AI_DAILY_SPEND_LIMIT_RUB', null);
const EFFECTIVE_TOKEN_LIMIT = DAILY_SPEND_LIMIT_RUB != null && DAILY_SPEND_LIMIT_RUB > 0
  ? Math.min(GLOBAL_TOKEN_LIMIT, Math.floor((DAILY_SPEND_LIMIT_RUB / RUB_PER_1M_TOKENS) * 1_000_000))
  : GLOBAL_TOKEN_LIMIT;

/**
 * Резерв глобального дневного бюджета одним стейтментом.
 *
 * R7Q-024(b): условие денежного потолка стоит и на вставке первого запроса дня
 * (`SELECT … WHERE $3 <= $4`), а не только в ветке `ON CONFLICT … WHERE`: иначе
 * одна оценка входа при низком AI_DAILY_SPEND_LIMIT_RUB съедала весь суточный
 * бюджет. Пустой RETURNING = отказ, как при переполнении.
 */
export const RESERVE_GLOBAL_REQUEST_SQL = `
       INSERT INTO public.ai_global_daily (date, call_count, tokens)
       SELECT $1, 1, $3::int
        WHERE $3::int <= $4::bigint
       ON CONFLICT (date) DO UPDATE SET
         call_count = public.ai_global_daily.call_count + 1,
         tokens     = coalesce(public.ai_global_daily.tokens, 0) + $3::int
       WHERE public.ai_global_daily.call_count < $2::int
         AND coalesce(public.ai_global_daily.tokens, 0) + $3::int <= $4::bigint
       RETURNING coalesce(tokens, 0) AS tokens_reserved`;

async function tryReserveGlobalRequest(allowance = 8192): Promise<GlobalReservation | null | { error: 'unavailable' }> {
  const date = today();
  try {
    // Резервация токенов атомарна вместе с вызовом: раньше tokens читались
    // после инкремента call_count, и N конкурентных запросов видели один и тот
    // же устаревший остаток — потолок был мягким под нагрузкой.
    const res = await pool.query(
      RESERVE_GLOBAL_REQUEST_SQL,
      [date, GLOBAL_DAILY_LIMIT, allowance, EFFECTIVE_TOKEN_LIMIT],
    );
    if (res.rows.length === 0) {
      return null;
    }
    return { date, shardId: '0', allowance };
  } catch (e) {
    console.error('[postgresAiContext] tryReserveGlobalRequest error', safeErrorShape(e));
    return { error: 'unavailable' };
  }
}

async function refundGlobalRequest(res: GlobalReservation | { error: 'unavailable' } | null | undefined): Promise<void> {
  if (!res || ('error' in res)) return;
  if (res.refunded) return;
  res.refunded = true;
  try {
    // Резерв снимается вместе с вызовом: иначе каждая неудача навсегда съедает
    // свой allowance из суточного потолка — час лежащего провайдера выбрал бы
    // потолок, не потратив ни одного токена.
    await pool.query(
      `UPDATE public.ai_global_daily
          SET call_count = GREATEST(0, call_count - 1),
               tokens     = GREATEST(0, coalesce(tokens, 0) - $2::int)
         WHERE date = $1`,
      [res.date, res.allowance],
    );
  } catch (e) {
    console.error('[postgresAiContext] refundGlobalRequest error', safeErrorShape(e));
  }
}

// ── Per-user daily limit ─────────────────────────────────────────────────────
const PER_USER_LIMIT = envInt('AI_DAILY_LIMIT', DAILY_LIMIT);

// ── Согласие на обработку (AUD-2) ────────────────────────────────────────────
// Клиентский гейт в callAi обходится прямым запросом к /api/chat — именно этим
// путём идёт основной чат. Гарантия «без согласия текст не обрабатывается»
// может стоять только здесь, где ей не нужны честность браузера.
async function getAiConsent(uid: string): Promise<{ granted: boolean; error?: 'unavailable' }> {
  try {
    const { rows } = await pool.query(
      'SELECT ai_consent_at, ai_consent_version FROM public.users WHERE uid = $1',
      [uid],
    );
    const row = rows[0];
    return {
      granted: !!row?.ai_consent_at
        && (row.ai_consent_version ?? 0) >= AI_CONSENT_VERSION_REQUIRED,
    };
  } catch (e) {
    // Ошибка чтения — не «согласия нет»: отказ обработки по сбою БД запер бы
    // весь чат. Но и пропустить нельзя, поэтому наружу отдаём отказ со статусом unavailable,
    // а причина уходит в журнал.
    console.error('[postgresAiContext] getAiConsent error', safeErrorShape(e));
    return { granted: false, error: 'unavailable' };
  }
}

async function getIndexingConsent(uid: string): Promise<{ granted: boolean; error?: 'unavailable' }> {
  try {
    const { rows } = await pool.query(
      'SELECT indexing_consent_at, indexing_consent_version FROM public.users WHERE uid = $1',
      [uid],
    );
    const row = rows[0];
    return {
      granted: !!row?.indexing_consent_at
        && (row.indexing_consent_version ?? 0) >= INDEXING_CONSENT_VERSION,
    };
  } catch (e) {
    console.error('[postgresAiContext] getIndexingConsent error', safeErrorShape(e));
    return { granted: false, error: 'unavailable' };
  }
}

async function isAdmin(uid: string, q: Queryable = pool): Promise<boolean> {
  try {
    const { rows } = await q.query('SELECT role FROM public.users WHERE uid = $1', [uid]);
    return rows[0]?.role === 'admin';
  } catch (e) {
    console.error('[postgresAiContext] isAdmin error', safeErrorShape(e));
    return false;
  }
}

async function getUserDailyLimit(uid: string, q: Queryable = pool): Promise<number> {
  if (await isAdmin(uid, q)) return ADMIN_DAILY_LIMIT;
  return PER_USER_LIMIT;
}

const REASONING_DAILY_LIMIT = envInt('AI_REASONING_DAILY_LIMIT', 5);

// ST-4: ADMIN_DAILY_LIMIT applies to chat; reasoning stays 5 for everyone unless the owner says otherwise
async function getUserReasoningLimit(_uid: string): Promise<number> {
  return REASONING_DAILY_LIMIT;
}

async function checkDailyLimit(uid: string, reasoning?: boolean): Promise<LimitVerdict> {
  let client;
  try {
    client = await pool.connect();
  } catch (e: unknown) {
    console.error('[postgresAiContext] checkDailyLimit pool.connect error', safeErrorShape(e));
    if (pgCode(e) === '23503') {
      return { ok: false, day: today(), reason: 'unauthorized' };
    }
    return { ok: false, day: today(), reason: 'unavailable' };
  }

  const onClientError = (err: unknown) => {
    console.error('[postgresAiContext] checkDailyLimit client error', safeErrorShape(err));
  };
  client.on('error', onClientError);

  try {
    await client.query('BEGIN');
    const date = today();
    const kind = reasoning ? 'reasoning' : 'chat';
    // N-77: потолок админа сверяется на этом же соединении — отдельного
    // запроса через пул здесь быть не может.
    const limit = reasoning ? await getUserReasoningLimit(uid) : await getUserDailyLimit(uid, client);

    const res = await client.query(
      `INSERT INTO public.ai_daily_limit (uid, day, kind, call_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (uid, day, kind) DO UPDATE SET call_count = public.ai_daily_limit.call_count + 1
       RETURNING call_count`,
      [uid, date, kind],
    );
    const count = Number(res.rows[0]?.call_count ?? 1);
    if (count > limit) {
      await client.query('ROLLBACK');
      return { ok: false, day: date, reason: 'limit_exceeded' };
    }
    await client.query('COMMIT');
    return { ok: true, day: date };
  } catch (e: unknown) {
    try {
      await client.query('ROLLBACK');
    } catch { /* ignore rollback failure */ }
    console.error('[postgresAiContext] checkDailyLimit error', safeErrorShape(e));
    if (pgCode(e) === '23503') {
      return { ok: false, day: today(), reason: 'unauthorized' };
    }
    return { ok: false, day: today(), reason: 'unavailable' };
  } finally {
    client.removeListener('error', onClientError);
    client.release();
  }
}

async function refundDailyLimit(uid: string, chargedDay: string, kind: string = 'chat'): Promise<void> {
  try {
    await pool.query(
      `UPDATE public.ai_daily_limit SET call_count = GREATEST(0, call_count - 1) WHERE uid = $1 AND day = $2 AND kind = $3`,
      [uid, chargedDay, kind],
    );
  } catch (e) {
    console.error('[postgresAiContext] refundDailyLimit error', safeErrorShape(e));
  }
}

async function getDailyLimitCount(uid: string): Promise<{ used: number; reasoningUsed: number; date: string }> {
  const date = today();
  const res = await pool.query(
    `SELECT kind, call_count FROM public.ai_daily_limit WHERE uid = $1 AND day = $2 AND kind IN ('chat', 'reasoning')`,
    [uid, date],
  );
  let used = 0;
  let reasoningUsed = 0;
  for (const row of res.rows) {
    if (row.kind === 'chat') used = Number(row.call_count ?? 0);
    if (row.kind === 'reasoning') reasoningUsed = Number(row.call_count ?? 0);
  }
  return { used, reasoningUsed, date };
}

// ── Bulk limit (reuse per-user table with a separate kind) ────────────────────
const BULK_LIMIT = envInt('AI_BULK_DAILY_LIMIT', 50);
const INTERNAL_CHAT_DAILY_LIMIT = envInt('AI_INTERNAL_CHAT_DAILY_LIMIT', 60);
// AUD-18: суточный потолок без лимита во времени позволяет вычерпать весь
// день за минуту. Ключ — (uid, endpoint): rerank, embed и chat троттлятся
// независимо.
//
// Это скользящее окно с бюджетом вызовов, а НЕ «один вызов в интервал».
// Фоновые эндпоинты бурстят по своей природе: `embed` зовётся раз на каждый
// поиск в чате и раз на заметку при индексации архива (шаг 150 мс). Жёсткие
// 1/мин остановили бы индексацию на одной заметке в минуту, а второй поиск за
// ту же минуту откатился бы на keyword-only. Ровно это уже случалось
// 2026-06-16 с 10-секундным кулдауном на embedDocument.
const BULK_WINDOW_MS = envInt('AI_BULK_WINDOW_MS', 60000);
const BULK_MAX_PER_WINDOW = envInt('AI_BULK_MAX_PER_WINDOW', 20);

async function checkAndIncrementBulkLimit(
  uid: string,
  endpoint: string = 'bulk',
  kind?: string,
): Promise<LimitVerdict | 'RATE_LIMIT'> {
  // Окно и счётчик двигаются одним стейтментом: если окно истекло — оно
  // начинается заново со счётчиком 1, иначе счётчик растёт внутри текущего.
  //
  // R7Q-024(a): двигаются они в ОДНОЙ транзакции с суточным потолком. Прежний
  // upsert окна коммитился до проверки дневного лимита, и каждый отказ
  // `limit_exceeded` сжигал слот частотного окна — фоновые проходы, упёршиеся
  // в потолок, лишались бюджета окна целиком.
  let client;
  try {
    client = await pool.connect();
  } catch (e: unknown) {
    console.error('[postgresAiContext] checkAndIncrementBulkLimit pool.connect error', safeErrorShape(e));
    if (pgCode(e) === '23503') {
      return { ok: false, day: today(), reason: 'unauthorized' };
    }
    return { ok: false, day: today(), reason: 'unavailable' };
  }

  const onClientError = (err: unknown) => {
    console.error('[postgresAiContext] checkAndIncrementBulkLimit client error', safeErrorShape(err));
  };
  client.on('error', onClientError);

  try {
    await client.query('BEGIN');
    // Если таблицы ограничителя нет (миграция накатывается отдельно от выкатки
    // службы) или база моргнула — окно пропускается, суточный потолок ниже
    // остаётся в силе: уронить весь фоновый ИИ из-за недоступного счётчика
    // частоты хуже, чем на время не ограничивать частоту. Молча это происходить
    // не должно, поэтому строка в журнал уходит громкая, а сама вставка
    // откатывается к savepoint — аборт транзакции съел бы и суточную проверку.
    await client.query('SAVEPOINT bulk_window');
    try {
      const { rows } = await client.query(
        `INSERT INTO public.ai_bulk_cooldown (uid, endpoint, window_start, calls)
         VALUES ($1, $3, now(), 1)
         ON CONFLICT (uid, endpoint) DO UPDATE SET
           window_start = CASE
             WHEN public.ai_bulk_cooldown.window_start < now() - ($2 || ' milliseconds')::interval
             THEN now() ELSE public.ai_bulk_cooldown.window_start END,
           calls = CASE
             WHEN public.ai_bulk_cooldown.window_start < now() - ($2 || ' milliseconds')::interval
             THEN 1 ELSE public.ai_bulk_cooldown.calls + 1 END
         RETURNING calls`,
        [uid, String(BULK_WINDOW_MS), endpoint],
      );
      if (Number(rows[0]?.calls ?? 1) > BULK_MAX_PER_WINDOW) {
        await client.query('ROLLBACK');
        return 'RATE_LIMIT';
      }
    } catch (e: unknown) {
      if (pgCode(e) === '23503') {
        await client.query('ROLLBACK');
        return { ok: false, day: today(), reason: 'unauthorized' };
      }
      await client.query('ROLLBACK TO SAVEPOINT bulk_window');
      console.error(
        '[postgresAiContext] AUD-18 bulk window unavailable — rate limiting is OFF, ' +
        'daily cap still applies. Apply supabase/migrations/0022_ai_bulk_cooldown.sql.',
        safeErrorShape(e),
      );
    }
    const date = today();
    const resolvedKind = kind ?? (endpoint === 'chat' ? 'internal_chat' : 'bulk');
    const limit = resolvedKind === 'internal_chat' ? INTERNAL_CHAT_DAILY_LIMIT : BULK_LIMIT;
    const res = await client.query(
      `INSERT INTO public.ai_daily_limit (uid, day, kind, call_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (uid, day, kind) DO UPDATE SET call_count = public.ai_daily_limit.call_count + 1
       RETURNING call_count`,
      [uid, date, resolvedKind],
    );
    const count = Number(res.rows[0]?.call_count ?? 1);
    if (count > limit) {
      await client.query('ROLLBACK');
      return { ok: false, day: date, reason: 'limit_exceeded' };
    }
    await client.query('COMMIT');
    return { ok: true, day: date };
  } catch (e: unknown) {
    try {
      await client.query('ROLLBACK');
    } catch { /* ignore rollback failure */ }
    console.error('[postgresAiContext] checkAndIncrementBulkLimit error', safeErrorShape(e));
    if (pgCode(e) === '23503') {
      return { ok: false, day: today(), reason: 'unauthorized' };
    }
    return { ok: false, day: today(), reason: 'unavailable' };
  } finally {
    client.removeListener('error', onClientError);
    client.release();
  }
}

async function refundBulkLimit(uid: string, chargedDay: string, kind: string = 'bulk'): Promise<void> {
  try {
    if (kind === 'bulk') {
      await pool.query(
        `UPDATE public.ai_daily_limit SET call_count = GREATEST(0, call_count - 1) WHERE uid = $1 AND day = $2 AND kind = 'bulk'`,
        [uid, chargedDay],
      );
    } else {
      await pool.query(
        `UPDATE public.ai_daily_limit SET call_count = GREATEST(0, call_count - 1) WHERE uid = $1 AND day = $2 AND kind = $3`,
        [uid, chargedDay, kind],
      );
    }
  } catch (e) {
    console.error('[postgresAiContext] refundBulkLimit error', safeErrorShape(e));
  }
}

const COOLDOWN_MS = 10000;

async function resetCooldown(uid: string): Promise<void> {
  try {
    await pool.query('DELETE FROM public.ai_cooldown WHERE uid = $1', [uid]);
  } catch (e) {
    console.error('[postgresAiContext] resetCooldown error', safeErrorShape(e));
  }
}

async function checkAndIncrementLimit(
  uid: string,
  reasoning?: boolean,
): Promise<{ ok: true; day: string } | 'DAILY_LIMIT' | 'REASONING_LIMIT' | 'RATE_LIMIT' | { error: 'RATE_LIMIT'; retryAfterSec: number } | 'UNAVAILABLE' | 'UNAUTHORIZED'> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.ai_cooldown (uid, updated_at) VALUES ($1, now())
       ON CONFLICT (uid) DO UPDATE SET updated_at = now()
         WHERE public.ai_cooldown.updated_at < now() - ($2 || ' milliseconds')::interval
       RETURNING uid`,
      [uid, String(COOLDOWN_MS)],
    );
    if (rows.length === 0) {
      try {
        const rem = await pool.query(
          `SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (updated_at + ($2 || ' milliseconds')::interval - now()))))::int AS rem_sec
           FROM public.ai_cooldown WHERE uid = $1`,
          [uid, String(COOLDOWN_MS)],
        );
        const retryAfterSec = Number(rem.rows[0]?.rem_sec ?? 10);
        return { error: 'RATE_LIMIT', retryAfterSec };
      } catch {
        return 'RATE_LIMIT';
      }
    }
  } catch (e: unknown) {
    if (pgCode(e) === '23503') return 'UNAUTHORIZED';
    console.error('[postgresAiContext] checkAndIncrementLimit cooldown error', safeErrorShape(e));
    return 'UNAVAILABLE';
  }

  const verdict = await checkDailyLimit(uid, reasoning);
  if (verdict.ok) return { ok: true, day: verdict.day };
  if (verdict.reason === 'unauthorized') return 'UNAUTHORIZED';
  if (verdict.reason === 'unavailable') return 'UNAVAILABLE';
  return reasoning ? 'REASONING_LIMIT' : 'DAILY_LIMIT';
}

async function recordUsage(
  uid: string,
  tokensIn: number,
  tokensOut: number,
  opts?: { model?: string; fn?: string },
  reservation?: GlobalReservation | null,
): Promise<void> {
  // Дата берётся из того же today(), что и резервирование в
  // tryReserveGlobalRequest. Раньше здесь стоял current_date — это дата по
  // часовому поясу базы, и при поясе не-UTC расход писался в строку другого
  // дня, чем та, по которой проверяется потолок. Потолок при этом молчал.
  const date = today();
  const client = await pool.connect();
  const onClientError = (err: unknown) => {
    console.error('[postgresAiContext] recordUsage client error', safeErrorShape(err));
  };
  client.on('error', onClientError);
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO public.ai_usage (uid, date, data)
         VALUES ($1, $4,
                 jsonb_build_object('promptTokens', $2::int,
                                    'completionTokens', $3::int,
                                    'requests', 1))
       ON CONFLICT (uid, date) DO UPDATE SET data =
         jsonb_set(jsonb_set(jsonb_set(public.ai_usage.data,
           '{promptTokens}',     to_jsonb(coalesce((public.ai_usage.data->>'promptTokens')::int, 0)     + $2::int)),
           '{completionTokens}', to_jsonb(coalesce((public.ai_usage.data->>'completionTokens')::int, 0) + $3::int)),
           '{requests}',         to_jsonb(coalesce((public.ai_usage.data->>'requests')::int, 0)         + 1))`,
      [uid, tokensIn, tokensOut, date],
    );
    await client.query(
      `INSERT INTO public.ai_usage_calls (uid, fn, model, tokens_in, tokens_out)
       VALUES ($1, $2, $3, $4, $5)`,
      [uid, opts?.fn ?? 'unknown', opts?.model ?? null, tokensIn, tokensOut],
    );
    // Сверка резерва с фактом: allowance уже лежит в tokens (зарезервирован
    // атомарно), добавляем только дельту. GREATEST защищает от гонки с refund.
    if (reservation && !reservation.refunded) {
      await client.query(
        `UPDATE public.ai_global_daily
            SET tokens = GREATEST(0, coalesce(tokens, 0) - $3::int + $1::int)
          WHERE date = $2::text`,
        [tokensIn + tokensOut, reservation.date, reservation.allowance],
      );
      reservation.refunded = true; // резерв погашен этим вызовом
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.removeListener('error', onClientError);
    client.release();
  }
}

export const postgresAiContext: AiContext = {
  recordUsage,
  tryReserveGlobalRequest,
  refundGlobalRequest,
  getAiConsent,
  getIndexingConsent,
  checkDailyLimit,
  refundDailyLimit,
  getDailyLimitCount,
  getUserDailyLimit,
  isAdmin,
  checkAndIncrementBulkLimit,
  refundBulkLimit,
  checkAndIncrementLimit,
  resetCooldown,
};
