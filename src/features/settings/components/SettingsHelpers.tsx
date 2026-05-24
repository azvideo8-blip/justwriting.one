import React from 'react';
import { cn } from '../../../core/utils/utils';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-label-sm font-bold uppercase tracking-widest text-text-main/40 px-1">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function ToggleRow({ emoji, label, hint, value, onChange }: {
  emoji?: string;
  label: string;
  hint?: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border-subtle hover:bg-text-main/5 transition-colors w-full"
    >
      {emoji && <span className="text-base shrink-0">{emoji}</span>}
      <div className="flex-1 text-left">
        <span className="text-sm text-text-main/70">{label}</span>
        {hint && <p className="text-label text-text-main/40 mt-0.5">{hint}</p>}
      </div>
      <div className={cn(
        "w-8 h-4 rounded-full relative transition-colors duration-200 shrink-0",
        value ? "bg-text-main" : "bg-text-main/20"
      )}>
        <div className={cn(
          "absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200",
          value ? "translate-x-4" : "translate-x-0"
        )} />
      </div>
    </button>
  );
}
