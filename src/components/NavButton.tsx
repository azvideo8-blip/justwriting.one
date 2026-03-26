import React from 'react';
import { cn } from '../lib/utils';

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  className?: string;
}

export function NavButton({ active, onClick, icon, label, className }: NavButtonProps) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300",
        active 
          ? "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-lg shadow-stone-200 dark:shadow-none" 
          : "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800",
        className
      )}
    >
      {icon}
      <span className="font-bold text-sm">{label}</span>
    </button>
  );
}
