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
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className={cn("border-b", isV2 ? "bg-white/5 border-white/10" : "bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800")}>
          <th className={cn("px-6 py-4 text-xs font-bold uppercase tracking-widest", isV2 ? "text-white/50" : "text-stone-400")}>Заголовок</th>
          <th className={cn("px-6 py-4 text-xs font-bold uppercase tracking-widest", isV2 ? "text-white/50" : "text-stone-400")}>Автор</th>
          <th className={cn("px-6 py-4 text-xs font-bold uppercase tracking-widest", isV2 ? "text-white/50" : "text-stone-400")}>Дата</th>
          <th className={cn("px-6 py-4 text-xs font-bold uppercase tracking-widest", isV2 ? "text-white/50" : "text-stone-400")}>Действия</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map(s => (
          <tr key={s.id} className={cn("border-b last:border-0", isV2 ? "border-white/10" : "border-stone-100 dark:border-stone-800")}>
            <td className={cn("px-6 py-4 text-sm font-medium", isV2 ? "text-white" : "dark:text-stone-200")}>{s.title || 'Без названия'}</td>
            <td className={cn("px-6 py-4 text-sm", isV2 ? "text-white/70" : "text-stone-500")}>{s.authorName || 'Аноним'}</td>
            <td className={cn("px-6 py-4 text-sm", isV2 ? "text-white/50" : "text-stone-400")}>
              {s.createdAt ? format(parseFirestoreDate(s.createdAt), 'dd.MM.yyyy HH:mm') : '-'}
            </td>
            <td className="px-6 py-4">
              <button 
                onClick={() => onDelete(s.id)}
                className={cn("p-2 transition-colors", isV2 ? "text-white/30 hover:text-red-400" : "text-stone-400 hover:text-red-500")}
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
