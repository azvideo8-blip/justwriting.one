import React from 'react';
import { AdminUser } from '../../views/AdminView';

interface AdminUsersTableProps {
  users: AdminUser[];
}

export function AdminUsersTable({ users }: AdminUsersTableProps) {
  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="bg-stone-50 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800">
          <th className="px-6 py-4 text-xs font-bold text-stone-400 uppercase tracking-widest">Email</th>
          <th className="px-6 py-4 text-xs font-bold text-stone-400 uppercase tracking-widest">UID</th>
          <th className="px-6 py-4 text-xs font-bold text-stone-400 uppercase tracking-widest">Роль</th>
        </tr>
      </thead>
      <tbody>
        {users.map(u => (
          <tr key={u.id} className="border-b border-stone-100 dark:border-stone-800 last:border-0">
            <td className="px-6 py-4 text-sm font-medium dark:text-stone-200">{u.email}</td>
            <td className="px-6 py-4 text-sm font-mono text-stone-400">{u.uid}</td>
            <td className="px-6 py-4">
              <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${u.role === 'admin' ? 'bg-red-100 text-red-600' : 'bg-stone-100 text-stone-600'}`}>
                {u.role || 'user'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
