import React from 'react';
import { useUI } from '../../../contexts/UIContext';
import { cn } from '../../../core/utils/utils';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}

export function StatCard({ icon, label, value }: StatCardProps) {
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  return (
    <div className={cn(
      "p-4 rounded-2xl flex flex-col items-center text-center transition-all",
      isV2 
        ? "bg-white/5 border border-white/10 backdrop-blur-md" 
        : "bg-stone-50 dark:bg-stone-950 border border-stone-100 dark:border-stone-800"
    )}>
      <div className={cn("mb-1", isV2 ? "text-white/50" : "text-stone-400 dark:text-stone-500")}>{icon}</div>
      <span className={cn("text-[10px] font-bold uppercase tracking-widest", isV2 ? "text-white/40" : "text-stone-400 dark:text-stone-500")}>{label}</span>
      <span className={cn("text-xl font-bold", isV2 ? "text-white" : "dark:text-stone-100")}>{value}</span>
    </div>
  );
}
