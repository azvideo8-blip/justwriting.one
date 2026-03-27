import React from 'react';
import { cn } from '../lib/utils';
import { useUI } from '../contexts/UIContext';

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  className?: string;
}

export function NavButton({ active, onClick, icon, label, className }: NavButtonProps) {
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300",
        isV2 
          ? (active 
              ? "bg-white/10 text-white shadow-[0_0_15px_rgba(255,255,255,0.05)]" 
              : "text-white/50 hover:bg-white/5 hover:text-white/80")
          : (active 
              ? "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-lg shadow-stone-200 dark:shadow-none" 
              : "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"),
        className
      )}
    >
      {icon}
      <span className="font-bold text-sm">{label}</span>
    </button>
  );
}
