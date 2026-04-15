import React from 'react';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { parseFirestoreDate } from '../../../core/utils/utils';
import { useLanguage } from '../../../core/i18n';

import { Session } from '../../../types';

interface AdminSessionsTableProps {
  sessions: Session[];
  onDelete: (id: string) => void;
}

export function AdminSessionsTable({ sessions, onDelete }: AdminSessionsTableProps) {
  const { t } = useLanguage();
  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="border-b bg-surface-base/5 border-border-subtle">
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">{t('admin_col_title')}</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">{t('admin_col_author')}</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">{t('admin_col_date')}</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">{t('admin_col_actions')}</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map(s => (
          <tr key={s.id} className="border-b last:border-0 border-border-subtle">
            <td className="px-6 py-4 text-sm font-medium text-text-main">{s.title || t('common_untitled')}</td>
            <td className="px-6 py-4 text-sm text-text-main/70">{s.authorName || t('common_anonymous')}</td>
            <td className="px-6 py-4 text-sm text-text-main/50">
              {s.createdAt ? format(parseFirestoreDate(s.createdAt), 'dd.MM.yyyy HH:mm') : '-'}
            </td>
            <td className="px-6 py-4">
              <button 
                onClick={() => onDelete(s.id)}
                className="p-3 transition-colors text-text-main/40 hover:text-red-400"
              >
                <Trash2 size={18} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
