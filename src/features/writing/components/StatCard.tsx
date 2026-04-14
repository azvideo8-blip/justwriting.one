import React from 'react';
import { cn } from '../../../core/utils/utils';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}

export function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <div className="p-4 rounded-2xl flex flex-col items-center text-center transition-all bg-surface-card border border-border-subtle backdrop-blur-md">
      <div className="mb-1 text-text-main/50">{icon}</div>
      <span className="text-[11px] font-bold uppercase tracking-widest text-text-main/40">{label}</span>
      <span className="text-xl font-bold text-text-main">{value}</span>
    </div>
  );
}
