import React from 'react';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { parseFirestoreDate } from '../../lib/utils';
import { Session } from '../../types';

interface AdminSessionsTableProps {
  sessions: Session[];
  onDelete: (id: string) => void;
}

export function AdminSessionsTable({ sessions, onDelete }: AdminSessionsTableProps) {
  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="bg-stone-50 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800">
          <th className="px-6 py-4 text-xs font-bold text-stone-400 uppercase tracking-widest">Заголовок</th>
          <th className="px-6 py-4 text-xs font-bold text-stone-400 uppercase tracking-widest">Автор</th>
          <th className="px-6 py-4 text-xs font-bold text-stone-400 uppercase tracking-widest">Дата</th>
          <th className="px-6 py-4 text-xs font-bold text-stone-400 uppercase tracking-widest">Действия</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map(s => (
          <tr key={s.id} className="border-b border-stone-100 dark:border-stone-800 last:border-0">
            <td className="px-6 py-4 text-sm font-medium dark:text-stone-200">{s.title || 'Без названия'}</td>
            <td className="px-6 py-4 text-sm text-stone-500">{s.authorName || 'Аноним'}</td>
            <td className="px-6 py-4 text-sm text-stone-400">
              {s.createdAt ? format(parseFirestoreDate(s.createdAt), 'dd.MM.yyyy HH:mm') : '-'}
            </td>
            <td className="px-6 py-4">
              <button 
                onClick={() => onDelete(s.id)}
                className="p-2 text-stone-400 hover:text-red-500 transition-colors"
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
