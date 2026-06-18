import React from 'react';
import { cn } from '../utils/cn';

export function StatCard({ value, label, accent }: {
  value: string | number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className={cn(
      'flex-1 flex flex-col gap-1 p-3.5 px-4 rounded-[14px]',
      'bg-white/[0.03] border',
      accent ? 'border-[oklch(0.72_0.13_155/0.3)]' : 'border-white/[0.07]'
    )}>
      <div className={cn(
        'text-2xl font-medium leading-none tabular-nums',
        accent ? 'text-brand-primary' : 'text-text-main/95'
      )}>
        {value}
      </div>
      <div className="text-[11px] font-mono uppercase tracking-[0.06em] text-text-main/60">
        {label}
      </div>
    </div>
  );
}

export function SettingRow({ label, children, hint }: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="py-3.5 border-b border-white/[0.05] flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-text-main/80">{label}</span>
        {children}
      </div>
      {hint && (
        <div className="text-[11px] text-text-main/60">{hint}</div>
      )}
    </div>
  );
}
