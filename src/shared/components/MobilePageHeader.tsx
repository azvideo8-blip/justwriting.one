import React from 'react';
import { cn } from '../../shared/utils/cn';

interface MobilePageHeaderProps {
  title: string;
  right?: React.ReactNode;
  className?: string;
  titleFont?: 'serif' | 'sans';
}

export function MobilePageHeader({ title, right, className, titleFont = 'serif' }: MobilePageHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-center justify-between px-5 bg-surface-base border-b border-border-subtle shrink-0 w-full z-10",
        "h-[calc(44px+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)]",
        className
      )}
    >
      <h1 className={cn(
        "text-[18px] font-semibold text-text-main truncate",
        titleFont === 'serif' ? "font-serif" : "font-sans"
      )}>
        {title}
      </h1>
      {right != null && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </header>
  );
}
