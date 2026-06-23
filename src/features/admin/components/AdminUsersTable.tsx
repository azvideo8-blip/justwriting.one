import React from 'react';
import { RotateCcw, Loader2 } from 'lucide-react';
import { cn } from '../../../core/utils/utils';
import { useLanguage } from '../../../shared/i18n';

import { UserProfile } from '../../../types';

interface AdminUsersTableProps {
  users: UserProfile[];
  onResetLimit?: (uid: string, displayName: string) => void;
  resettingUid?: string | null;
}

export function AdminUsersTable({ users, onResetLimit, resettingUid }: AdminUsersTableProps) {
  const { t } = useLanguage();
  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="border-b bg-surface-base/5 border-border-subtle">
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/60">{t('auth_email')}</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/60">UID</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/60">{t('admin_col_role')}</th>
          {onResetLimit && <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/60">AI лимит</th>}
        </tr>
      </thead>
      <tbody>
        {users.map(u => {
          const resetting = resettingUid === u.uid;
          const displayName = u.email || u.nickname || u.uid.slice(0, 8);
          return (
            <tr key={u.uid} className="border-b last:border-0 border-border-subtle">
              <td className="px-6 py-4 text-sm font-medium text-text-main">{u.email}</td>
              <td className="px-6 py-4 text-sm font-mono text-text-main/60">{u.uid}</td>
              <td className="px-6 py-4">
                <span className={cn(
                  "px-2 py-1 rounded-lg text-label-sm font-bold uppercase tracking-wider",
                  u.role === 'admin'
                    ? "bg-accent-danger/20 text-accent-danger"
                    : "bg-text-main/10 text-text-main/60"
                )}>
                  {u.role || 'user'}
                </span>
              </td>
              {onResetLimit && (
                <td className="px-6 py-4">
                  <button
                    type="button"
                    onClick={() => onResetLimit(u.uid, displayName)}
                    disabled={resetting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border-subtle text-text-main/70 hover:text-text-main hover:border-brand-soft/40 transition-colors disabled:opacity-40"
                  >
                    {resetting
                      ? <Loader2 size={12} className="animate-spin" />
                      : <RotateCcw size={12} />}
                    Сбросить
                  </button>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
