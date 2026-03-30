import React from 'react';
import { cn } from '../../../core/utils/utils';
import { useUI } from '../../../contexts/UIContext';

interface MobileNavButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  className?: string;
}

export function MobileNavButton({ active, onClick, icon, label, className }: MobileNavButtonProps) {
  const { uiVersion } = useUI();
  const isV2 = uiVersion === '2.0';

  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-4 p-4 rounded-2xl transition-all duration-300 w-full",
        isV2 
          ? (active 
              ? "bg-white/10 text-white shadow-[0_0_15px_rgba(255,255,255,0.05)]" 
              : "text-white/50 hover:bg-white/5 hover:text-white/80")
          : (active 
              ? "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-xl" 
              : "text-stone-500 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800/50"),
        className
      )}
    >
      {icon}
      <span className="font-semibold">{label}</span>
    </button>
  );
}
