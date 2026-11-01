import { z } from 'zod';
import { AiError } from '../../src/shared/ai/context.js';
import type { postgresAiContext } from '../postgresAiContext';
import { pool } from '../db';
import { getSupabaseAdmin } from './supabaseAdmin';
import { deleteUserRows } from '../account';
import { safeErrorShape } from '../../src/shared/ai/errorShape.js';

/** R7Q-009: почасовой бюджет админских удалений (считается по admin_actions). */
export const ADMIN_DELETES_PER_HOUR = 5;
/** Дейлик 28.10 Н-3: почасовой бюджет приглашений — тот же журнал, своё действие. */
export const ADMIN_INVITES_PER_HOUR = 20;

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

    // Н-3: приглашение — письмо с нашего домена; бюджет — по следам в admin_actions,
    // как у удалений. Как и там, решает пересчёт под блокировкой по админу в
    // транзакции: иначе два параллельных запроса оба видели «19 из 20» (TOCTOU).
    // След пишется в той же транзакции; письмо ушло, а след не записался — ошибка.
    // Быстрый отказ без соединения из пула — как у удалений.
    const pre = await pool.query<{ used: number }>(
      `select count(*)::int as used from public.admin_actions
        where admin_uid = $1 and action = 'invite_user' and at > now() - interval '1 hour'`,
      [uid],
    );
    if ((pre.rows[0]?.used ?? 0) >= ADMIN_INVITES_PER_HOUR) {
      throw new AiError('resource-exhausted', `Не больше ${ADMIN_INVITES_PER_HOUR} приглашений в час. Повторите позже.`);
    }
    const client = await pool.connect();
    let invited: { id?: string | undefined; email?: string | undefined } | undefined;
    try {
      await client.query('begin');
      // Блокировка без ожидания: письмо уходит внутри транзакции, и очередь из
      // ждущих запросов держала бы соединения пула (пачка запросов одного админа
      // выедала бы пул). Второй параллельный — сразу «повторите позже».
      const lock = await client.query('select pg_try_advisory_xact_lock(hashtext($1)) as locked', [`invite:${uid}`]);
      if (!(lock.rows[0] as { locked?: boolean } | undefined)?.locked) {
        throw new AiError('resource-exhausted', 'Приглашение уже отправляется. Повторите через минуту.');
      }
      const budget = await client.query(
        `select count(*)::int as used from public.admin_actions
          where admin_uid = $1 and action = 'invite_user' and at > now() - interval '1 hour'`,
        [uid],
      );
      if (((budget.rows[0] as { used?: number } | undefined)?.used ?? 0) >= ADMIN_INVITES_PER_HOUR) {
        throw new AiError('resource-exhausted', `Не больше ${ADMIN_INVITES_PER_HOUR} приглашений в час. Повторите позже.`);
      }

      const supabase = getSupabaseAdmin();
      const res = await supabase.auth.admin.inviteUserByEmail(email);
      if (res.error) {
        // Текст GoTrue не отдаём наружу (адреса, схема) — только в журнал службы.
        console.error('[admin] inviteUserByEmail failed:', res.error.message);
        throw new AiError('invalid-argument', 'Не удалось отправить приглашение.');
      }
      invited = res.data.user ?? undefined;
      if (invited?.id) {
        await client.query(
          'insert into public.admin_actions (admin_uid, action, target_uid) values ($1, $2, $3)',
          [uid, 'invite_user', invited.id],
        );
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => { /* намеренно: соединение уже в ошибке */ });
      throw e;
    } finally {
      client.release();
    }

    return {
      user: {
        id: invited?.id,
        email: invited?.email,
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
    console.error('[listUsersWithStatus] error:', safeErrorShape(err));
    throw new AiError('internal', 'Failed to retrieve user statuses');
  }
}

const deleteUserSchema = z.object({ uid: z.string().uuid() });

// C-6: уборка неактивированных приглашений — только по кнопке, без фоновой
// задачи. Условие одно и то же в списке и в удалении: неподтверждённый
// аккаунт с invited_at < now() - 30 days, не служебный.
export const STALE_INVITE_DAYS = 30;

export interface StaleInviteItem {
  uid: string;
  email: string;
  invitedAt: string;
}

const staleInvitesSql = `
  SELECT au.id AS uid, au.email, au.invited_at AS "invitedAt"
    FROM auth.users au
   WHERE au.invited_at IS NOT NULL
     AND au.invited_at < now() - ($1::int * interval '1 day')
     AND COALESCE(au.confirmed_at, au.email_confirmed_at) IS NULL
     AND (au.encrypted_password IS NULL OR au.encrypted_password = '')
     AND NOT EXISTS (SELECT 1 FROM public.service_accounts sa WHERE sa.uid = au.id)
   ORDER BY au.invited_at ASC
   LIMIT 500`;

export async function listStaleInvitesLogic(
  ctx: typeof postgresAiContext,
  uid: string,
  _data: unknown,
): Promise<StaleInviteItem[]> {
  if (!(await ctx.isAdmin(uid))) {
    throw new AiError('permission-denied', 'Admin access required');
  }
  try {
    const { rows } = await pool.query<{ uid: string; email: string; invitedAt: string | Date }>(
      staleInvitesSql, [STALE_INVITE_DAYS],
    );
    return rows.map(r => ({
      uid: r.uid,
      email: r.email,
      invitedAt: new Date(r.invitedAt).toISOString(),
    }));
  } catch (err: unknown) {
    // Сбой чтения — не «ноль приглашений»: кнопка удаления не должна получить
    // пустой список и объявить «удалено 0».
    console.error('[listStaleInvites] error:', safeErrorShape(err));
    throw new AiError('internal', 'Failed to list stale invites');
  }
}

const deleteStaleInvitesSchema = z.object({ uids: z.array(z.string().uuid()).min(1).max(500) });

export async function deleteStaleInvitesLogic(
  ctx: typeof postgresAiContext,
  uid: string,
  data: unknown,
): Promise<{ deleted: number; failed: number }> {
  if (!(await ctx.isAdmin(uid))) {
    throw new AiError('permission-denied', 'Admin access required');
  }
  const parsed = deleteStaleInvitesSchema.safeParse(data);
  if (!parsed.success) throw new AiError('invalid-argument', 'Invalid invite list');

  let deleted = 0;
  let failed = 0;
  for (const target of parsed.data.uids) {
    // Дейлик 31.10 (Н-1): тот же набор строк, что у самоудаления и удаления
    // админом, — общий вход deleteUserRows (с журналом GoTrue, где лежит почта).
    // Одна транзакция на приглашение: проверка, удаление и след — вместе.
    const client = await pool.connect();
    try {
      await client.query('begin');
      // Повторная проверка под транзакцией: между показом списка и
      // подтверждением человек мог активироваться.
      const still = await client.query(
        `SELECT 1 FROM auth.users au
          WHERE au.id = $1
            AND au.invited_at IS NOT NULL
            AND au.invited_at < now() - ($2::int * interval '1 day')
            AND COALESCE(au.confirmed_at, au.email_confirmed_at) IS NULL
            AND (au.encrypted_password IS NULL OR au.encrypted_password = '')
            AND NOT EXISTS (SELECT 1 FROM public.service_accounts sa WHERE sa.uid = au.id)`,
        [target, STALE_INVITE_DAYS],
      );
      // 0 строк из deleteUserRows — параллельный запрос уже удалил.
      if ((still.rowCount ?? 0) === 0 || (await deleteUserRows(client, target)) === 0) {
        await client.query('rollback');
        continue;
      }
      await client.query(
        'insert into public.admin_actions (admin_uid, action, target_uid) values ($1, $2, $3)',
        [uid, 'delete_stale_invite', target],
      );
      await client.query('commit');
      deleted++;
    } catch (e) {
      // Н-2: сбой одного не отменяет уже удалённые — счёт честный.
      await client.query('rollback').catch(() => undefined);
      console.error('[deleteStaleInvites] one invite failed:', safeErrorShape(e));
      failed++;
    } finally {
      client.release();
    }
  }
  return { deleted, failed };
}


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

/**
 * R7Q-014: чтение следа админских действий. Миграция 0038 обещала, что «кто и
 * кого удалил» будет читаться из админки, а не только из psql; механизм был,
 * чтения не было. Только последние строки, только админ, только чтение:
 * никаких фильтров, вставляемых в текст запроса — лимит идёт bound-параметром.
 */
export const ADMIN_ACTIONS_DEFAULT_LIMIT = 50;
export const ADMIN_ACTIONS_MAX_LIMIT = 200;

export interface AdminActionItem {
  id: number;
  at: string;
  adminUid: string;
  action: string;
  targetUid: string;
}

export async function listAdminActionsLogic(
  ctx: typeof postgresAiContext,
  uid: string,
  data: unknown,
): Promise<AdminActionItem[]> {
  if (!(await ctx.isAdmin(uid))) {
    throw new AiError('permission-denied', 'Admin access required');
  }

  const raw = (data as { limit?: unknown } | null | undefined)?.limit;
  const requested = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : NaN;
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, ADMIN_ACTIONS_MAX_LIMIT)
    : ADMIN_ACTIONS_DEFAULT_LIMIT;

  const { rows } = await pool.query<{
    id: string | number;
    at: Date | string;
    admin_uid: string;
    action: string;
    target_uid: string;
  }>(
    `select id, at, admin_uid, action, target_uid
       from public.admin_actions
      order by at desc
      limit $1`,
    [limit],
  );

  return rows.map((r) => ({
    id: Number(r.id),
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
    adminUid: r.admin_uid,
    action: r.action,
    targetUid: r.target_uid,
  }));
}
