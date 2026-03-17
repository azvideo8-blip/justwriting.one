import React from 'react';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}

export function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <div className="bg-stone-50 dark:bg-stone-950 p-4 rounded-2xl border border-stone-100 dark:border-stone-800 flex flex-col items-center text-center">
      <div className="text-stone-400 dark:text-stone-500 mb-1">{icon}</div>
      <span className="text-[10px] font-bold text-stone-400 dark:text-stone-500 uppercase tracking-widest">{label}</span>
      <span className="text-xl font-bold dark:text-stone-100">{value}</span>
    </div>
  );
}
