// api/account.ts — the two endpoints the client calls that are not AI.
//
// Ported from functions/src/account/deleteAccount.ts and
// functions/src/telemetry/sendTelemetry.ts. Same behaviour, same limits; only
// the storage changes.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AiError } from '../src/shared/ai/context.js';

import { pool } from './db';

// ── sendTelemetry ───────────────────────────────────────────────────────────

// Ключ строки выводится из uid, а не приходит от клиента. Раньше клиент задавал
// его сам, а ветка conflict сливала payload в существующую строку — то есть
// любой аккаунт мог перезаписать чужую статистику. Соль обязательна: без неё
// ключ — это просто хеш uid, и совпадение с чужой строкой подбирается перебором
// по списку uid.
export function telemetryRowId(uid: string): string {
  const pepper = process.env.TELEMETRY_ID_PEPPER;
  if (!pepper) throw new AiError('internal', 'Telemetry is not configured.');
  return createHash('sha256').update(`${uid}:${pepper}`).digest('hex');
}

const telemetrySchema = z.object({
  activeTheme: z.string().max(100).optional(),
  notesCountBucket: z.string().max(20).optional(),
  averageWordCount: z.number().min(0).optional(),
  reasoningRatio: z.number().min(0).max(1).optional(),
  doorRatios: z.object({
    thinking: z.number(),
    feeling: z.number(),
    behavior: z.number(),
  }).nullish(),
  sentAt: z.string().max(50).optional(),
});

const TELEMETRY_MIN_INTERVAL = '24 hours';

export async function sendTelemetryLogic(_ctx: unknown, uid: string, data: unknown): Promise<unknown> {
  const parsed = telemetrySchema.safeParse(data);
  if (!parsed.success) throw new AiError('invalid-argument', 'Invalid telemetry payload.');

  // Reserve the daily slot in one statement. Read-then-write would let two
  // concurrent sends both pass the check, which is the whole thing the limit
  // is for.
  const { rows } = await pool.query(
    `insert into telemetry_cooldown (uid, last_sent_at) values ($1, now())
     on conflict (uid) do update set last_sent_at = now()
       where telemetry_cooldown.last_sent_at < now() - $2::interval
     returning uid`,
    [uid, TELEMETRY_MIN_INTERVAL],
  );
  if (rows.length === 0) throw new AiError('resource-exhausted', 'Telemetry rate limit exceeded.');

  // CHOKE-6: The row carries no uid on purpose. The association uid <-> rowId
  // is permanent and deterministic via telemetryRowId (sha256 of uid + pepper);
  // telemetry_cooldown above enforces the rate limit on writes without storing the payload.
  const payload = parsed.data;
  const rowId = telemetryRowId(uid);
  await pool.query(
    `insert into anonymized_telemetry (id, data) values ($1, $2)
     on conflict (id) do update set data = anonymized_telemetry.data || excluded.data`,
    [rowId, JSON.stringify(payload)],
  );

  return { success: true };
}

// ── deleteAccount ───────────────────────────────────────────────────────────

// Cooldown на попытки удаления (аудит H6-остаток): re-auth по amr уже стоит,
// это второй барьер против перебора/залипания кнопки. In-memory достаточно:
// сервис живёт одним процессом на VPS, а после рестарта окно просто начнётся
// заново — гейт здесь не криптографический.
const DELETE_COOLDOWN_MS = 60 * 60 * 1000;
const lastDeleteAttempt = new Map<string, number>();

export function acquireDeleteSlot(uid: string, now: number = Date.now()): boolean {
  const prev = lastDeleteAttempt.get(uid);
  if (prev !== undefined && now - prev < DELETE_COOLDOWN_MS) return false;
  lastDeleteAttempt.set(uid, now);
  // Карта ограничена числом аккаунтов за час — чистим протухшие записи,
  // чтобы она не росла бесконечно.
  if (lastDeleteAttempt.size > 10_000) {
    for (const [k, t] of lastDeleteAttempt) {
      if (now - t >= DELETE_COOLDOWN_MS) lastDeleteAttempt.delete(k);
    }
  }
  return true;
}

export async function deleteAccountLogic(_ctx: unknown, uid: string): Promise<unknown> {
  if (!acquireDeleteSlot(uid)) {
    throw new AiError('resource-exhausted', 'Too many deletion attempts. Try again later.');
  }
  const client = await pool.connect();
  const onClientError = (err: unknown) => {
    console.error('[api/account] deleteAccount client error', err);
  };
  client.on('error', onClientError);
  try {
    await client.query('begin');

    // local_store_records (AI dialogues, chat memory, portrait, facets, life
    // story) has a cascading foreign key since 0032; the explicit delete stays
    // so a database restored from an older dump is still cleaned.
    await client.query('delete from public.local_store_records where user_id = $1', [uid]);

    // N-5: телеметрия обезличена (ключ — хеш uid с солью), но связь с аккаунтом у
    // неё есть, и при удалении аккаунта она уходит вместе с ним. Без соли строк
    // телеметрии не бывает — тогда и удалять нечего.
    if (process.env.TELEMETRY_ID_PEPPER) {
      await client.query('delete from public.anonymized_telemetry where id = $1', [telemetryRowId(uid)]);
    }

    // The remaining tables reference public.users(uid) with ON DELETE CASCADE,
    // so one delete takes documents, versions, drafts, summaries, embeddings,
    // limits and the telemetry cooldown with it.
    await client.query('delete from public.users where uid = $1', [uid]);

    // R6-008 / S-10: GoTrue audit log stores actor_id and user_id in payload with email.
    // Clean it up in the same transaction so no orphan PII remains.
    await client.query(
      "delete from auth.audit_log_entries where payload->>'actor_id' = $1 or payload->'traits'->>'user_id' = $1",
      [uid],
    );

    // Then the account itself. Deleting the profile without this leaves a login
    // that works and owns nothing — and the 0006 trigger only creates the
    // profile on signup, so it would never come back.
    await client.query('delete from auth.users where id = $1', [uid]);

    await client.query('commit');
    return { success: true };
  } catch (e) {
    try {
      await client.query('rollback');
    } catch { /* ignore rollback failure */ }
    console.error('[api/account] deleteAccount failed:', e);
    throw new AiError('internal', 'Account deletion failed.');
  } finally {
    client.removeListener('error', onClientError);
    client.release();
  }
}
