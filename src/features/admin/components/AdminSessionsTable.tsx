import React from 'react';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { parseFirestoreDate, cn } from '../../../core/utils/utils';
import { useUI } from '../../../contexts/UIContext';

import { Session } from '../../../types';

interface AdminSessionsTableProps {
  sessions: Session[];
  onDelete: (id: string) => void;
}

export function AdminSessionsTable({ sessions, onDelete }: AdminSessionsTableProps) {
  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="border-b bg-surface-base/5 border-border-subtle">
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">Заголовок</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">Автор</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">Дата</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">Действия</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map(s => (
          <tr key={s.id} className="border-b last:border-0 border-border-subtle">
            <td className="px-6 py-4 text-sm font-medium text-text-main">{s.title || 'Без названия'}</td>
            <td className="px-6 py-4 text-sm text-text-main/70">{s.authorName || 'Аноним'}</td>
            <td className="px-6 py-4 text-sm text-text-main/50">
              {s.createdAt ? format(parseFirestoreDate(s.createdAt), 'dd.MM.yyyy HH:mm') : '-'}
            </td>
            <td className="px-6 py-4">
              <button 
                onClick={() => onDelete(s.id)}
                className="p-2 transition-colors text-text-main/30 hover:text-red-400"
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
