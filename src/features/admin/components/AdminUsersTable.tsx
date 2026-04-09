import React from 'react';
import { cn } from '../../../core/utils/utils';
import { useUI } from '../../../contexts/UIContext';

import { UserProfile } from '../../../types';

interface AdminUsersTableProps {
  users: UserProfile[];
}

export function AdminUsersTable({ users }: AdminUsersTableProps) {
  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="border-b bg-surface-base/5 border-border-subtle">
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">Email</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">UID</th>
          <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-main/50">Роль</th>
        </tr>
      </thead>
      <tbody>
        {users.map(u => (
          <tr key={u.uid} className="border-b last:border-0 border-border-subtle">
            <td className="px-6 py-4 text-sm font-medium text-text-main">{u.email}</td>
            <td className="px-6 py-4 text-sm font-mono text-text-main/50">{u.uid}</td>
            <td className="px-6 py-4">
              <span className={cn(
                "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                u.role === 'admin' 
                  ? "bg-red-500/20 text-red-400" 
                  : "bg-text-main/10 text-text-main/50"
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
