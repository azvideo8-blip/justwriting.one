// api/account.ts — the two endpoints the client calls that are not AI.
//
// Ported from functions/src/account/deleteAccount.ts and
// functions/src/telemetry/sendTelemetry.ts. Same behaviour, same limits; only
// the storage changes.

import { Pool } from 'pg';
import { z } from 'zod';
import { AiError } from './ai/context';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── sendTelemetry ───────────────────────────────────────────────────────────

const telemetrySchema = z.object({
  telemetryId: z.string().min(1).max(100),
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
       where telemetry_cooldown.last_sent_at < now() - interval '${TELEMETRY_MIN_INTERVAL}'
     returning uid`,
    [uid],
  );
  if (rows.length === 0) throw new AiError('resource-exhausted', 'Telemetry rate limit exceeded.');

  // The row carries no uid on purpose: the cooldown above is the only place the
  // two are associated, and it keeps no payload.
  const payload = parsed.data;
  await pool.query(
    `insert into anonymized_telemetry (id, data) values ($1, $2)
     on conflict (id) do update set data = anonymized_telemetry.data || excluded.data`,
    [payload.telemetryId, JSON.stringify(payload)],
  );

  return { success: true };
}

// ── deleteAccount ───────────────────────────────────────────────────────────

export async function deleteAccountLogic(_ctx: unknown, uid: string): Promise<unknown> {
  const client = await pool.connect();
  try {
    await client.query('begin');

    // Every table that holds this person's data references public.users(uid)
    // with ON DELETE CASCADE, so one delete takes documents, versions, drafts,
    // summaries, embeddings, limits and the telemetry cooldown with it. Listing
    // them by hand would go stale the first time a table is added.
    await client.query('delete from public.users where uid = $1', [uid]);

    // Then the account itself. Deleting the profile without this leaves a login
    // that works and owns nothing — and the 0006 trigger only creates the
    // profile on signup, so it would never come back.
    await client.query('delete from auth.users where id = $1', [uid]);

    await client.query('commit');
    return { success: true };
  } catch (e) {
    await client.query('rollback');
    console.error('[api/account] deleteAccount failed:', e);
    throw new AiError('internal', 'Account deletion failed.');
  } finally {
    client.release();
  }
}
