import React from 'react';
import { cn } from '../../../core/utils/utils';
import { useUI } from '../../../contexts/UIContext';

interface AdminUsersTableProps {
  users: any[];
}

export function AdminUsersTable({ users }: AdminUsersTableProps) {
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className={cn("border-b", isV2 ? "bg-white/5 border-white/10" : "bg-stone-50 dark:bg-stone-950 border-stone-200 dark:border-stone-800")}>
          <th className={cn("px-6 py-4 text-xs font-bold uppercase tracking-widest", isV2 ? "text-white/50" : "text-stone-400")}>Email</th>
          <th className={cn("px-6 py-4 text-xs font-bold uppercase tracking-widest", isV2 ? "text-white/50" : "text-stone-400")}>UID</th>
          <th className={cn("px-6 py-4 text-xs font-bold uppercase tracking-widest", isV2 ? "text-white/50" : "text-stone-400")}>Роль</th>
        </tr>
      </thead>
      <tbody>
        {users.map(u => (
          <tr key={u.id} className={cn("border-b last:border-0", isV2 ? "border-white/10" : "border-stone-100 dark:border-stone-800")}>
            <td className={cn("px-6 py-4 text-sm font-medium", isV2 ? "text-white" : "dark:text-stone-200")}>{u.email}</td>
            <td className={cn("px-6 py-4 text-sm font-mono", isV2 ? "text-white/50" : "text-stone-400")}>{u.uid}</td>
            <td className="px-6 py-4">
              <span className={cn(
                "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                u.role === 'admin' 
                  ? (isV2 ? "bg-red-500/20 text-red-400" : "bg-red-100 text-red-600") 
                  : (isV2 ? "bg-white/10 text-white/50" : "bg-stone-100 text-stone-600")
              )}>
                {u.role || 'user'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
