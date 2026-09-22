import { z } from 'zod';
import { AiError } from '../../src/shared/ai/context.js';
import type { postgresAiContext } from '../postgresAiContext';
import { pool } from '../db';
import { getSupabaseAdmin } from './supabaseAdmin';

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.string().email()),
});

export interface UserStatusItem {
  uid: string;
  email: string;
  invitedAt: string | null;
  confirmedAt: string | null;
  createdAt: string | null;
  noteCount: number;
  pending: boolean;
}

export async function inviteUserLogic(
  ctx: typeof postgresAiContext,
  uid: string,
  data: unknown,
): Promise<{ user: { id?: string | undefined; email?: string | undefined } }> {
  if (!(await ctx.isAdmin(uid))) {
    throw new AiError('permission-denied', 'Admin access required');
  }

  const parsed = inviteSchema.safeParse(data);
  if (!parsed.success) {
    throw new AiError('invalid-argument', 'Invalid email address');
  }

  const { email } = parsed.data;

  try {
    const supabase = getSupabaseAdmin();
    const { data: resData, error } = await supabase.auth.admin.inviteUserByEmail(email);

    if (error) {
      throw new AiError('invalid-argument', error.message);
    }

    return {
      user: {
        id: resData.user?.id,
        email: resData.user?.email,
      },
    };
  } catch (err: unknown) {
    if (err instanceof AiError) throw err;
    const msg = err instanceof Error ? err.message : 'Failed to invite user';
    throw new AiError('internal', msg);
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
      createdAt: string | Date | null;
      noteCount: number;
    }>(
      `SELECT
         au.id AS uid,
         au.email,
         au.invited_at AS "invitedAt",
         COALESCE(au.confirmed_at, au.email_confirmed_at) AS "confirmedAt",
         au.created_at AS "createdAt",
         COALESCE(d.note_count, 0)::int AS "noteCount"
       FROM auth.users au
       LEFT JOIN (
         SELECT user_id, count(*)::int AS note_count
         FROM public.documents
         GROUP BY user_id
       ) d ON d.user_id = au.id
       ORDER BY au.created_at DESC`,
    );

    return rows.map((r) => ({
      uid: r.uid,
      email: r.email,
      invitedAt: r.invitedAt !== null && r.invitedAt !== undefined ? new Date(r.invitedAt).toISOString() : null,
      confirmedAt: r.confirmedAt !== null && r.confirmedAt !== undefined ? new Date(r.confirmedAt).toISOString() : null,
      createdAt: r.createdAt !== null && r.createdAt !== undefined ? new Date(r.createdAt).toISOString() : null,
      noteCount: Number(r.noteCount) || 0,
      pending: r.invitedAt !== null && r.invitedAt !== undefined && (r.confirmedAt === null || r.confirmedAt === undefined),
    }));
  } catch (err: unknown) {
    if (err instanceof AiError) throw err;
    console.error('[listUsersWithStatus] error:', err);
    throw new AiError('internal', 'Failed to retrieve user statuses');
  }
}
