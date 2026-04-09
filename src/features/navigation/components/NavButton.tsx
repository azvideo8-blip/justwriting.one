import React from 'react';
import { cn } from '../../../core/utils/utils';

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
          ? "bg-text-main text-surface-base shadow-lg" 
          : "text-text-main/50 hover:bg-white/10 hover:text-text-main",
        className
      )}
    >
      {icon}
      <span className="font-bold text-sm">{label}</span>
    </button>
  );
}
