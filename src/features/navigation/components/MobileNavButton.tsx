import React from 'react';
import { cn } from '../../../core/utils/utils';

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
        active 
          ? "bg-text-main text-surface-base shadow-[0_0_15px_rgba(255,255,255,0.05)]" 
          : "text-text-main/50 hover:bg-surface-base/5 hover:text-text-main/80",
        className
      )}
    >
      {icon}
      <span className="font-semibold">{label}</span>
    </button>
  );
}
