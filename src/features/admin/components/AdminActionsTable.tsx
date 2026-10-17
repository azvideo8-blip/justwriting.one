import React from 'react';
import { useLanguage } from '../../../shared/i18n';
import type { AdminActionItem } from '../../../core/services/AdminUserService';

/**
 * R7Q-014: последние строки `admin_actions` — след того, кто и кого удалил.
 * Миграция 0038 заводила таблицу «чтобы читалось из админки», до этого путь к
 * следу был только через psql.
 *
 * Только чтение, и это не украшение: править или стирать исторический след
 * админского действия означает терять его вместе с обвинением. Клиентский
 * endpoint тоже read-only, поэтому здесь нет ни одной управляющей кнопки.
 */
export function AdminActionsTable({ actions }: { actions: AdminActionItem[] }) {
  const { t } = useLanguage();

  const actionLabel = (action: string): string =>
    action === 'delete_user' ? t('admin_action_delete_user') : action;

  const at = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  };

  if (actions.length === 0) {
    return <p className="px-3 py-4 text-sm text-text-muted">{t('admin_actions_empty')}</p>;
  }

  return (
    <table className="w-full text-left text-xs" data-testid="admin-actions-table">
      <thead>
        <tr className="text-text-muted">
          <th className="px-3 py-2 font-medium">{t('admin_actions_col_at')}</th>
          <th className="px-3 py-2 font-medium">{t('admin_actions_col_action')}</th>
          <th className="px-3 py-2 font-medium">{t('admin_actions_col_admin')}</th>
          <th className="px-3 py-2 font-medium">{t('admin_actions_col_target')}</th>
        </tr>
      </thead>
      <tbody>
        {actions.map(a => (
          <tr key={a.id} className="border-t border-border-subtle">
            <td className="px-3 py-2 whitespace-nowrap">{at(a.at)}</td>
            <td className="px-3 py-2">{actionLabel(a.action)}</td>
            <td className="px-3 py-2 font-mono">{a.adminUid}</td>
            <td className="px-3 py-2 font-mono">{a.targetUid}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
