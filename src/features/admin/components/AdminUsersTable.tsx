import React from 'react';
import { RotateCcw, Loader2, KeyRound } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';

import { AdminUserItem } from '../../../types';

interface AdminUsersTableProps {
  users: AdminUserItem[];
  onResetLimit?: (uid: string, displayName: string) => void;
  resettingUid?: string | null;
  onSendPasswordReset?: (email: string) => void;
  sendingResetEmail?: string | null;
}

export function AdminUsersTable({
  users,
  onResetLimit,
  resettingUid,
  onSendPasswordReset,
  sendingResetEmail,
}: AdminUsersTableProps) {
  const { t } = useLanguage();

  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="border-b bg-surface-base/5 border-border-subtle">
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/60">{t('auth_email')}</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/60">UID</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/60">{t('admin_col_role')}</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/60">{t('admin_col_status')}</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/60">{t('admin_col_activity')}</th>
          {(onSendPasswordReset || onResetLimit) && (
            <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/60">{t('admin_col_actions')}</th>
          )}
        </tr>
      </thead>
      <tbody>
        {users.map((u) => {
          const resetting = resettingUid === u.uid;
          const sendingReset = sendingResetEmail === u.email;
          const displayName = u.email || u.nickname || u.uid.slice(0, 8);
          const isPending = Boolean(u.pending);
          const noteCount = u.noteCount ?? 0;
          const isActive = noteCount > 0;

          return (
            <tr key={u.uid} className="border-b last:border-0 border-border-subtle">
              <td className="px-6 py-4 text-sm font-medium text-text-main">{u.email || '—'}</td>
              <td className="px-6 py-4 text-sm font-mono text-text-main/60">{u.uid}</td>
              <td className="px-6 py-4">
                <span
                  className={cn(
                    'px-2 py-1 rounded-lg text-label-sm font-bold uppercase tracking-wider',
                    u.role === 'admin'
                      ? 'bg-accent-danger/20 text-accent-danger'
                      : 'bg-text-main/10 text-text-main/60',
                  )}
                >
                  {u.role || 'user'}
                </span>
              </td>
              <td className="px-6 py-4">
                {isPending ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                    {t('admin_status_invited')}
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    {t('admin_status_registered')}
                  </span>
                )}
              </td>
              <td className="px-6 py-4">
                {isActive ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-soft/20 text-text-main">
                    {t('admin_activity_active')} ({noteCount})
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-text-main/10 text-text-main/50">
                    {t('admin_activity_inactive')} (0)
                  </span>
                )}
              </td>
              {(onSendPasswordReset || onResetLimit) && (
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    {onSendPasswordReset && u.email && (
                      <button
                        type="button"
                        onClick={() => onSendPasswordReset(u.email)}
                        disabled={sendingReset}
                        title={t('admin_reset_password_btn')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle text-text-main/70 hover:text-text-main hover:border-brand-soft/40 transition-colors disabled:opacity-40"
                      >
                        {sendingReset ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <KeyRound size={12} />
                        )}
                        {t('admin_reset_password_btn')}
                      </button>
                    )}
                    {onResetLimit && (
                      <button
                        type="button"
                        onClick={() => onResetLimit(u.uid, displayName)}
                        disabled={resetting}
                        title={t('admin_reset')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle text-text-main/70 hover:text-text-main hover:border-brand-soft/40 transition-colors disabled:opacity-40"
                      >
                        {resetting ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RotateCcw size={12} />
                        )}
                        {t('admin_reset')}
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
