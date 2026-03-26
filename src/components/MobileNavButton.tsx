import React from 'react';
import { cn } from '../lib/utils';

interface MobileNavButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  className?: string;
}

export function MobileNavButton({ active, onClick, icon, label, className }: MobileNavButtonProps) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-4 p-4 rounded-2xl transition-all duration-300 w-full",
        active ? "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-xl" : "text-stone-500 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800/50",
        className
      )}
    >
      {icon}
      <span className="font-semibold">{label}</span>
    </button>
  );
}
