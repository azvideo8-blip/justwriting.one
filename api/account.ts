// api/account.ts — account-level endpoints.
//
// Ported from functions/src/account/deleteAccount.ts.

import { AiError } from '../src/shared/ai/context.js';
import type { PoolClient } from 'pg';
import { pool } from './db';

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

/**
 * Every row of one account, in one order — shared by self-deletion and the
 * admin «delete user» (2026-10-05), so the two can't drift apart. The caller
 * owns the transaction. Returns how many auth.users rows went (0 = no such user).
 */
export async function deleteUserRows(client: Pick<PoolClient, 'query'>, uid: string): Promise<number> {
  // local_store_records (AI dialogues, chat memory, portrait, facets, life
  // story) has a cascading foreign key since 0032; the explicit delete stays
  // so a database restored from an older dump is still cleaned.
  await client.query('delete from public.local_store_records where user_id = $1', [uid]);

  // The remaining tables reference public.users(uid) with ON DELETE CASCADE,
  // so one delete takes documents, versions, drafts, summaries, embeddings,
  // and limits with it.
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
  const res = await client.query('delete from auth.users where id = $1', [uid]);
  return res.rowCount ?? 0;
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
    await deleteUserRows(client, uid);
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
