import { z } from 'zod';
import { AiError } from '../../src/shared/ai/context.js';
import type { postgresAiContext } from '../postgresAiContext';
import { pool } from '../db';
import { getSupabaseAdmin } from './supabaseAdmin';
import { deleteUserRows } from '../account';

/** R7Q-009: почасовой бюджет админских удалений (считается по admin_actions). */
export const ADMIN_DELETES_PER_HOUR = 5;

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.string().email().max(254)),
});

export interface UserStatusItem {
  uid: string;
  email: string;
  invitedAt: string | null;
  confirmedAt: string | null;
  createdAt: string | null;
  noteCount: number;
  pending: boolean;
  service: boolean;
}

export async function inviteUserLogic(
  ctx: typeof postgresAiContext,
  uid: string,
  data: unknown,
): Promise<{ user: { id?: string | undefined; email?: string | undefined }; reinvited?: boolean }> {
  if (!(await ctx.isAdmin(uid))) {
    throw new AiError('permission-denied', 'Admin access required');
  }

  const parsed = inviteSchema.safeParse(data);
  if (!parsed.success) {
    throw new AiError('invalid-argument', 'Invalid email address');
  }

  const { email } = parsed.data;

  try {
    const existing = await pool.query<{
      hasPassword: boolean;
      invitedAt: string | Date | null;
    }>(
      `SELECT
        (encrypted_password IS NOT NULL AND encrypted_password <> '') AS "hasPassword",
        invited_at AS "invitedAt"
      FROM auth.users
      WHERE lower(email) = lower($1)
      LIMIT 1`,
      [email],
    );

    // DA-20: у кого пароль уже есть, тому приглашение — это письмо со ссылкой на
    // смену пароля. С украденным админ-токеном так захватывается любой аккаунт.
    if (existing.rows[0]?.hasPassword) {
      throw new AiError('invalid-argument', 'Этот человек уже зарегистрирован — приглашение не нужно.');
    }
    const isReinvite = existing.rows.length > 0;

    const supabase = getSupabaseAdmin();
    const { data: resData, error } = await supabase.auth.admin.inviteUserByEmail(email);

    if (error) {
      // Текст GoTrue не отдаём наружу (адреса, схема) — только в журнал службы.
      console.error('[admin] inviteUserByEmail failed:', error.message);
      throw new AiError('invalid-argument', 'Не удалось отправить приглашение.');
    }

    return {
      user: {
        id: resData.user?.id,
        email: resData.user?.email,
      },
      reinvited: isReinvite,
    };
  } catch (err: unknown) {
    if (err instanceof AiError) throw err;
    console.error('[admin] invite failed:', err instanceof Error ? err.message : err);
    throw new AiError('internal', 'Не удалось отправить приглашение.');
  }
}

export async function listUsersWithStatusLogic(
  ctx: typeof postgresAiContext,
  uid: string,
  _data: unknown,
): Promise<UserStatusItem[]> {
  if (!(await ctx.isAdmin(uid))) {
    throw new AiError('permission-denied', 'Admin access required');
  }

  try {
    const { rows } = await pool.query<{
      uid: string;
      email: string;
      invitedAt: string | Date | null;
      confirmedAt: string | Date | null;
      hasPassword?: boolean | null;
      createdAt: string | Date | null;
      noteCount: number;
      service: boolean;
    }>(
      `SELECT
         au.id AS uid,
         au.email,
         au.invited_at AS "invitedAt",
         COALESCE(au.confirmed_at, au.email_confirmed_at) AS "confirmedAt",
         (au.encrypted_password IS NOT NULL AND au.encrypted_password <> '') AS "hasPassword",
         au.created_at AS "createdAt",
         COALESCE(d.note_count, 0)::int AS "noteCount",
         EXISTS (SELECT 1 FROM public.service_accounts sa WHERE sa.uid = au.id) AS "service"
       FROM auth.users au
       LEFT JOIN (
         SELECT user_id, count(*)::int AS note_count
         FROM public.documents
         WHERE deleted_at IS NULL AND trashed_at IS NULL
         GROUP BY user_id
       ) d ON d.user_id = au.id
       ORDER BY au.created_at DESC`,
    );

    return rows.map((r) => {
      const hasPassword = r.hasPassword !== undefined
        ? Boolean(r.hasPassword)
        : (r.confirmedAt !== null && r.confirmedAt !== undefined);

      return {
        uid: r.uid,
        email: r.email,
        invitedAt: r.invitedAt !== null && r.invitedAt !== undefined ? new Date(r.invitedAt).toISOString() : null,
        confirmedAt: r.confirmedAt !== null && r.confirmedAt !== undefined ? new Date(r.confirmedAt).toISOString() : null,
        createdAt: r.createdAt !== null && r.createdAt !== undefined ? new Date(r.createdAt).toISOString() : null,
        noteCount: Number(r.noteCount) || 0,
        pending: !hasPassword,
        service: Boolean(r.service),
      };
    });
  } catch (err: unknown) {
    if (err instanceof AiError) throw err;
    console.error('[listUsersWithStatus] error:', err);
    throw new AiError('internal', 'Failed to retrieve user statuses');
  }
}

const deleteUserSchema = z.object({ uid: z.string().uuid() });

/**
 * 2026-10-05 (owner request): an admin deletes another account — the same rows,
 * in the same transaction and order as self-deletion (deleteUserRows). Never
 * the caller, never another admin.
 */
export async function adminDeleteUserLogic(
  ctx: typeof postgresAiContext,
  uid: string,
  data: unknown,
): Promise<{ success: true }> {
  if (!(await ctx.isAdmin(uid))) {
    throw new AiError('permission-denied', 'Admin access required');
  }
  const parsed = deleteUserSchema.safeParse(data);
  if (!parsed.success) throw new AiError('invalid-argument', 'Invalid user id');
  const target = parsed.data.uid;
  if (target === uid) throw new AiError('invalid-argument', 'Себя удалить отсюда нельзя — для этого есть удаление аккаунта в настройках.');
  if (await ctx.isAdmin(target)) throw new AiError('permission-denied', 'Администратора удалить нельзя.');
  // 0040: на служебном аккаунте держится проверка входа при выкатке — удалённый,
  // он откатывает каждую выкатку (2026-10-06).
  const service = await pool.query('select 1 from public.service_accounts where uid = $1', [target]);
  if ((service.rowCount ?? 0) > 0) {
    throw new AiError('permission-denied', 'Служебный аккаунт удалить нельзя — на нём держится проверка выкатки.');
  }

  // R7Q-009: бюджет считаем по следам в `admin_actions`, а не в памяти процесса:
  // рестарт службы, второй инстанс и параллельные вкладки админа не должны
  // обнулять счётчик. Порог — «несколько устаревших приглашений в час», массовое
  // зачистка архивов штатным сценарием не бывает.
  const budget = await pool.query(
    `select count(*)::int as used
       from public.admin_actions
      where admin_uid = $1
        and action = 'delete_user'
        and at > now() - interval '1 hour'`,
    [uid],
  );
  if ((budget.rows[0]?.used ?? 0) >= ADMIN_DELETES_PER_HOUR) {
    throw new AiError(
      'resource-exhausted',
      `Не больше ${ADMIN_DELETES_PER_HOUR} удалений в час. Повторите позже — или разберите списки по одному.`,
    );
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    // Проверка выше — быстрый отказ без транзакции; решает эта. Два параллельных
    // запроса одного админа иначе оба видели «4 из 5» и проходили вместе (TOCTOU):
    // блокировка по админу держится до конца транзакции, пересчёт — под ней.
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [uid]);
    const recount = await client.query(
      `select count(*)::int as used from public.admin_actions
        where admin_uid = $1 and action = 'delete_user' and at > now() - interval '1 hour'`,
      [uid],
    );
    if (((recount.rows[0] as { used?: number } | undefined)?.used ?? 0) >= ADMIN_DELETES_PER_HOUR) {
      await client.query('rollback');
      throw new AiError(
        'resource-exhausted',
        `Не больше ${ADMIN_DELETES_PER_HOUR} удалений в час. Повторите позже — или разберите списки по одному.`,
      );
    }
    const deleted = await deleteUserRows(client, target);
    if (deleted === 0) {
      await client.query('rollback');
      throw new AiError('invalid-argument', 'Пользователь не найден — возможно, его уже удалили.');
    }
    // V-3: след живёт в базе, а не только в логе процесса. Пишется в той же
    // транзакции — либо удалено и записано, либо ничего.
    await client.query(
      'insert into public.admin_actions (admin_uid, action, target_uid) values ($1, $2, $3)',
      [uid, 'delete_user', target],
    );
    await client.query('commit');
    console.warn(`[admin] user deleted by ${uid}: ${target}`);
    return { success: true };
  } catch (err: unknown) {
    try { await client.query('rollback'); } catch { /* уже откатили или соединение потеряно */ }
    if (err instanceof AiError) throw err;
    console.error('[admin] delete user failed:', err instanceof Error ? err.message : err);
    throw new AiError('internal', 'Не удалось удалить пользователя.');
  } finally {
    client.release();
  }
}
